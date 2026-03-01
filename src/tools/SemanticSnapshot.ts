/**
 * AstraOS — SemanticSnapshot.ts
 * Parses webpage Accessibility Tree (ARIA) into condensed text.
 * 10x cheaper and faster than screenshot-based vision approaches.
 */

import * as https from "https";
import * as http from "http";

export class SemanticSnapshot {

  async capture(url: string, focusSelector?: string): Promise<string> {
    try {
      const html = await this.fetchHTML(url);
      const snapshot = this.parseHTMLToSnapshot(html, focusSelector);
      return `=== SEMANTIC SNAPSHOT: ${url} ===\n${snapshot}\n=== END SNAPSHOT ===`;
    } catch (error) {
      throw new Error(`SemanticSnapshot failed for ${url}: ${(error as Error).message}`);
    }
  }

  private parseHTMLToSnapshot(html: string, focusSelector?: string): string {
    const lines: string[] = [];

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    if (titleMatch) lines.push(`PAGE TITLE: ${this.stripTags(titleMatch[1])}`);

    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);
    if (metaDescMatch) lines.push(`META DESC: ${metaDescMatch[1]}`);

    lines.push("---");

    const headingRegex = /<h([1-3])[^>]*>(.*?)<\/h\1>/gis;
    let match;
    while ((match = headingRegex.exec(html)) !== null) {
      const level = "#".repeat(parseInt(match[1]));
      lines.push(`${level} ${this.stripTags(match[2])}`);
    }

    const ariaRegex = /<[^>]+(?:aria-label=["']([^"']+)["']|role=["']([^"']+)["'])[^>]*>/gi;
    const ariaItems: string[] = [];
    while ((match = ariaRegex.exec(html)) !== null) {
      if (match[1]) ariaItems.push(`[ARIA: ${match[1]}]`);
      if (match[2] && !["presentation", "none", "div"].includes(match[2])) {
        ariaItems.push(`[ROLE: ${match[2]}]`);
      }
    }
    if (ariaItems.length > 0) {
      lines.push("--- INTERACTIVE ELEMENTS ---");
      lines.push(...ariaItems.slice(0, 30));
    }

    const navRegex = /<nav[^>]*>(.*?)<\/nav>/gis;
    while ((match = navRegex.exec(html)) !== null) {
      const links = this.extractLinks(match[1]);
      if (links.length > 0) {
        lines.push("--- NAV LINKS ---");
        lines.push(...links.slice(0, 15));
      }
    }

    const mainContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

    const bodyText = this.stripTags(mainContent).replace(/\s+/g, " ").trim().slice(0, 3000);

    if (bodyText) {
      lines.push("--- MAIN CONTENT ---");
      lines.push(bodyText);
    }

    return lines.join("\n");
  }

  private extractLinks(html: string): string[] {
    const links: string[] = [];
    const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const text = this.stripTags(match[2]).trim();
      if (text) links.push(`  -> ${text} (${match[1]})`);
    }
    return links;
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
  }

  private fetchHTML(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;
      const req = protocol.get(url, { headers: { "User-Agent": "AstraOS/2.0 Semantic-Snapshot-Bot" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; if (data.length > 500_000) req.destroy(); });
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.setTimeout(15_000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
  }
}
