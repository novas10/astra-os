/**
 * AstraOS — Enterprise SSO
 * SAML 2.0 and OpenID Connect (OIDC) for enterprise single sign-on.
 * Supports Azure AD, Okta, Google Workspace, Auth0, OneLogin, etc.
 */

import { Router, Request, Response } from "express";
import * as crypto from "crypto";
import { logger } from "../utils/logger";

// ─── Types ───

export interface SSOProvider {
  id: string;
  name: string;
  type: "saml" | "oidc";
  tenantId: string;
  enabled: boolean;
  config: SAMLConfig | OIDCConfig;
  createdAt: string;
}

export interface SAMLConfig {
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  certificate: string;
  signRequests: boolean;
  nameIdFormat: string;
  attributeMapping: Record<string, string>; // SAML attribute -> AstraOS field
}

export interface OIDCConfig {
  clientId: string;
  clientSecret: string;
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  callbackUrl: string;
  claimMapping: Record<string, string>; // OIDC claim -> AstraOS field
}

export interface SSOSession {
  id: string;
  providerId: string;
  state: string;
  nonce?: string;
  codeVerifier?: string;
  redirectUrl: string;
  createdAt: number;
  expiresAt: number;
}

export interface SSOUser {
  externalId: string;
  email: string;
  name: string;
  groups?: string[];
  attributes: Record<string, string>;
  providerId: string;
}

// ─── SSO Manager ───

export class SSOManager {
  private providers: Map<string, SSOProvider> = new Map();
  private sessions: Map<string, SSOSession> = new Map();
  private router: Router;
  private callbackBaseUrl: string;

  constructor() {
    this.callbackBaseUrl = process.env.ASTRA_BASE_URL || "http://localhost:3000";
    this.router = Router();
    this.setupRoutes();
    this.cleanupInterval();
  }

  // ─── Provider Management ───

  addProvider(config: Omit<SSOProvider, "id" | "createdAt">): SSOProvider {
    const id = `sso_${crypto.randomBytes(8).toString("hex")}`;
    const provider: SSOProvider = {
      ...config,
      id,
      createdAt: new Date().toISOString(),
    };

    this.providers.set(id, provider);
    logger.info(`[SSO] Provider added: ${provider.name} (${provider.type})`);
    return provider;
  }

  getProvider(id: string): SSOProvider | undefined {
    return this.providers.get(id);
  }

  getProvidersByTenant(tenantId: string): SSOProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.tenantId === tenantId);
  }

  updateProvider(id: string, updates: Partial<SSOProvider>): SSOProvider | undefined {
    const provider = this.providers.get(id);
    if (!provider) return undefined;
    Object.assign(provider, updates);
    return provider;
  }

  deleteProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  // ─── OIDC Flow ───

  initiateOIDCLogin(providerId: string, redirectUrl: string): { loginUrl: string; sessionId: string } {
    const provider = this.providers.get(providerId);
    if (!provider || provider.type !== "oidc") throw new Error("Invalid OIDC provider");

    const config = provider.config as OIDCConfig;
    const state = crypto.randomBytes(32).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    const session: SSOSession = {
      id: `sess_${crypto.randomBytes(8).toString("hex")}`,
      providerId,
      state,
      nonce,
      codeVerifier,
      redirectUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000, // 10 minutes
    };

    this.sessions.set(state, session);

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl || `${this.callbackBaseUrl}/api/sso/callback/oidc`,
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return {
      loginUrl: `${config.authorizationUrl}?${params}`,
      sessionId: session.id,
    };
  }

  async handleOIDCCallback(code: string, state: string): Promise<SSOUser> {
    const session = this.sessions.get(state);
    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid or expired SSO session");
    }

    const provider = this.providers.get(session.providerId);
    if (!provider) throw new Error("Provider not found");

    const config = provider.config as OIDCConfig;

    // Exchange code for tokens
    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl || `${this.callbackBaseUrl}/api/sso/callback/oidc`,
        code_verifier: session.codeVerifier || "",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokens = (await tokenResponse.json()) as { access_token: string; id_token?: string };

    // Fetch user info
    const userInfoResponse = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error(`UserInfo request failed: ${userInfoResponse.status}`);
    }

    const userInfo = (await userInfoResponse.json()) as Record<string, string>;

    // Map claims to AstraOS user
    const mapping = config.claimMapping || { sub: "externalId", email: "email", name: "name" };
    const ssoUser: SSOUser = {
      externalId: userInfo[mapping.sub || "sub"] || userInfo.sub,
      email: userInfo[mapping.email || "email"] || userInfo.email,
      name: userInfo[mapping.name || "name"] || userInfo.name || userInfo.email,
      groups: userInfo.groups ? (Array.isArray(userInfo.groups) ? userInfo.groups : [userInfo.groups]) : undefined,
      attributes: userInfo,
      providerId: provider.id,
    };

    // Cleanup session
    this.sessions.delete(state);

    logger.info(`[SSO] OIDC login successful: ${ssoUser.email} via ${provider.name}`);
    return ssoUser;
  }

  // ─── SAML Flow ───

  initiateSAMLLogin(providerId: string, redirectUrl: string): { loginUrl: string; sessionId: string } {
    const provider = this.providers.get(providerId);
    if (!provider || provider.type !== "saml") throw new Error("Invalid SAML provider");

    const config = provider.config as SAMLConfig;
    const id = `_${crypto.randomBytes(16).toString("hex")}`;
    const issueInstant = new Date().toISOString();
    const state = crypto.randomBytes(32).toString("hex");

    // Build SAML AuthnRequest
    const authnRequest = `<samlp:AuthnRequest
      xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
      xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
      ID="${id}" Version="2.0" IssueInstant="${issueInstant}"
      AssertionConsumerServiceURL="${this.callbackBaseUrl}/api/sso/callback/saml"
      Destination="${config.ssoUrl}">
      <saml:Issuer>${config.entityId}</saml:Issuer>
      <samlp:NameIDPolicy Format="${config.nameIdFormat}" AllowCreate="true"/>
    </samlp:AuthnRequest>`;

    const encoded = Buffer.from(authnRequest).toString("base64");

    const session: SSOSession = {
      id: `sess_${crypto.randomBytes(8).toString("hex")}`,
      providerId,
      state,
      redirectUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    };

    this.sessions.set(state, session);

    const params = new URLSearchParams({
      SAMLRequest: encoded,
      RelayState: state,
    });

    return {
      loginUrl: `${config.ssoUrl}?${params}`,
      sessionId: session.id,
    };
  }

  handleSAMLCallback(samlResponse: string, relayState: string): SSOUser {
    const session = this.sessions.get(relayState);
    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid or expired SSO session");
    }

    const provider = this.providers.get(session.providerId);
    if (!provider) throw new Error("Provider not found");

    const config = provider.config as SAMLConfig;

    // Decode SAML response (simplified — production should validate XML signature)
    const decoded = Buffer.from(samlResponse, "base64").toString("utf-8");

    // Extract basic attributes (simplified parser)
    const nameId = this.extractXmlValue(decoded, "NameID") || "unknown";
    const email = this.extractXmlAttribute(decoded, config.attributeMapping?.email || "email") || nameId;
    const name = this.extractXmlAttribute(decoded, config.attributeMapping?.name || "displayName") || email;

    const ssoUser: SSOUser = {
      externalId: nameId,
      email,
      name,
      attributes: { nameId, samlResponse: "[present]" },
      providerId: provider.id,
    };

    this.sessions.delete(relayState);
    logger.info(`[SSO] SAML login successful: ${ssoUser.email} via ${provider.name}`);
    return ssoUser;
  }

  private extractXmlValue(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`));
    return match ? match[1] : null;
  }

  private extractXmlAttribute(xml: string, attrName: string): string | null {
    const attrMatch = xml.match(new RegExp(`Name="${attrName}"[\\s\\S]*?<saml:AttributeValue[^>]*>([^<]*)<`));
    return attrMatch ? attrMatch[1] : null;
  }

  private cleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [state, session] of this.sessions) {
        if (session.expiresAt < now) this.sessions.delete(state);
      }
    }, 60_000);
  }

  // ─── Routes ───

  private setupRoutes(): void {
    // List providers for tenant
    this.router.get("/providers", (req: Request, res: Response) => {
      const tenantId = req.query.tenantId as string || "default";
      const providers = this.getProvidersByTenant(tenantId).map((p) => ({
        id: p.id, name: p.name, type: p.type, enabled: p.enabled,
      }));
      res.json(providers);
    });

    // Add provider
    this.router.post("/providers", (req: Request, res: Response) => {
      try {
        const provider = this.addProvider(req.body);
        res.json(provider);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // Initiate login
    this.router.get("/login/:providerId", (req: Request, res: Response) => {
      const { providerId } = req.params;
      const redirectUrl = (req.query.redirect as string) || "/";

      try {
        const provider = this.getProvider(providerId);
        if (!provider) return res.status(404).json({ error: "Provider not found" });

        if (provider.type === "oidc") {
          const { loginUrl } = this.initiateOIDCLogin(providerId, redirectUrl);
          res.redirect(loginUrl);
        } else {
          const { loginUrl } = this.initiateSAMLLogin(providerId, redirectUrl);
          res.redirect(loginUrl);
        }
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // OIDC callback
    this.router.get("/callback/oidc", async (req: Request, res: Response) => {
      try {
        const { code, state } = req.query;
        const user = await this.handleOIDCCallback(code as string, state as string);
        const session = this.sessions.get(state as string);
        // In production: create JWT, set cookie, redirect
        res.json({ user, redirect: session?.redirectUrl || "/" });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // SAML callback
    this.router.post("/callback/saml", (req: Request, res: Response) => {
      try {
        const { SAMLResponse, RelayState } = req.body;
        const user = this.handleSAMLCallback(SAMLResponse, RelayState);
        res.json({ user });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // Delete provider
    this.router.delete("/providers/:id", (req: Request, res: Response) => {
      const ok = this.deleteProvider(req.params.id);
      res.json({ success: ok });
    });
  }

  getRouter(): Router {
    return this.router;
  }
}
