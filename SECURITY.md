# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.5.x   | Yes       |
| < 3.5   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in AstraOS, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email:** Send details to **security@astra-os.dev**
2. **Subject:** `[SECURITY] Brief description of the vulnerability`
3. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Affected component (e.g., GatewayShield, CredentialVault, SkillSandbox)
   - Potential impact assessment
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix timeline** communicated within 14 days
- **Credit** in the security advisory (unless you prefer anonymity)

### Scope

The following are in scope for security reports:

- Authentication and authorization bypass
- Path traversal or file system escape in sandboxes
- XSS, CSRF, or injection vulnerabilities
- Credential exposure or encryption weaknesses
- SkillSandbox bypass or malicious skill execution
- GatewayShield bypass
- CredentialVault key exposure
- Privilege escalation in RBAC
- Data residency boundary violations

### Out of Scope

- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report those upstream)
- Vulnerabilities requiring physical access

## Security Architecture

AstraOS employs defense-in-depth with three dedicated security subsystems:

- **GatewayShield** — Request-level protection (CVE prevention, CSRF, brute force, IP filtering, security headers)
- **CredentialVault** — AES-256-GCM encrypted secret storage with key rotation and audit trail
- **SkillSandbox** — Ed25519 skill signing, static analysis, permission enforcement, quarantine

See the [README](README.md#security) for full security documentation.
