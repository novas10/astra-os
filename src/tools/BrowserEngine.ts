/**
 * AstraOS — BrowserEngine.ts
 * Chrome DevTools Protocol (CDP) browser control.
 * Full browser automation: navigate, click, type, screenshot, scrape.
 */

import puppeteer, { Browser, Page } from "puppeteer";
import { logger } from "../utils/logger";

export interface BrowserAction {
  action: "navigate" | "click" | "type" | "screenshot" | "evaluate" | "waitFor" | "scroll" | "select" | "extract" | "fill_form";
  selector?: string;
  url?: string;
  text?: string;
  script?: string;
  waitMs?: number;
  scrollY?: number;
  options?: Record<string, unknown>;
}

export interface BrowserResult {
  success: boolean;
  data?: string;
  screenshot?: Buffer;
  error?: string;
  url?: string;
  title?: string;
}

export class BrowserEngine {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map(); // sessionId -> Page
  private headless: boolean;

  constructor(headless = true) {
    this.headless = headless;
  }

  async initialize(): Promise<void> {
    try {
      this.browser = await puppeteer.launch({
        headless: this.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
      logger.info("[AstraOS] BrowserEngine: Chrome launched via CDP");
    } catch (err) {
      logger.warn(`[AstraOS] BrowserEngine: Failed to launch Chrome: ${(err as Error).message}`);
    }
  }

  private async getPage(sessionId: string): Promise<Page> {
    if (this.pages.has(sessionId)) {
      return this.pages.get(sessionId)!;
    }

    if (!this.browser) await this.initialize();
    if (!this.browser) throw new Error("Browser not available");

    const page = await this.browser.newPage();
    await page.setUserAgent("AstraOS/2.0 BrowserEngine");
    await page.setViewport({ width: 1280, height: 720 });
    this.pages.set(sessionId, page);
    return page;
  }

  async execute(sessionId: string, action: BrowserAction): Promise<BrowserResult> {
    try {
      const page = await this.getPage(sessionId);

      switch (action.action) {
        case "navigate": {
          if (!action.url) return { success: false, error: "URL required" };
          await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          return {
            success: true,
            url: page.url(),
            title: await page.title(),
            data: `Navigated to: ${page.url()}`,
          };
        }

        case "click": {
          if (!action.selector) return { success: false, error: "Selector required" };
          await page.waitForSelector(action.selector, { timeout: 5000 });
          await page.click(action.selector);
          return { success: true, data: `Clicked: ${action.selector}` };
        }

        case "type": {
          if (!action.selector || !action.text) return { success: false, error: "Selector and text required" };
          await page.waitForSelector(action.selector, { timeout: 5000 });
          await page.type(action.selector, action.text, { delay: 30 });
          return { success: true, data: `Typed into: ${action.selector}` };
        }

        case "screenshot": {
          const screenshot = await page.screenshot({
            fullPage: !!action.options?.fullPage,
            type: "png",
          }) as Buffer;
          return { success: true, screenshot, data: `Screenshot captured (${screenshot.length} bytes)` };
        }

        case "evaluate": {
          if (!action.script) return { success: false, error: "Script required" };
          const result = await page.evaluate(action.script);
          return { success: true, data: JSON.stringify(result, null, 2) };
        }

        case "waitFor": {
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: action.waitMs || 10_000 });
          } else {
            await new Promise((r) => setTimeout(r, action.waitMs || 1000));
          }
          return { success: true, data: "Wait completed" };
        }

        case "scroll": {
          await page.evaluate((y) => window.scrollBy(0, y), action.scrollY || 500);
          return { success: true, data: `Scrolled by ${action.scrollY || 500}px` };
        }

        case "select": {
          if (!action.selector || !action.text) return { success: false, error: "Selector and value required" };
          await page.select(action.selector, action.text);
          return { success: true, data: `Selected "${action.text}" in ${action.selector}` };
        }

        case "extract": {
          // Extract structured content from page
          const content = await page.evaluate(() => {
            const getText = (sel: string) => {
              const el = document.querySelector(sel);
              return el ? el.textContent?.trim() : null;
            };

            const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 20).map((a) => ({
              text: a.textContent?.trim(),
              href: (a as HTMLAnchorElement).href,
            }));

            const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((h) => ({
              level: h.tagName,
              text: h.textContent?.trim(),
            }));

            const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
              action: (f as HTMLFormElement).action,
              inputs: Array.from(f.querySelectorAll("input,select,textarea")).map((i) => ({
                type: (i as HTMLInputElement).type,
                name: (i as HTMLInputElement).name,
                placeholder: (i as HTMLInputElement).placeholder,
              })),
            }));

            return {
              title: document.title,
              url: window.location.href,
              text: document.body.innerText.slice(0, 5000),
              headings,
              links,
              forms,
            };
          });

          return { success: true, data: JSON.stringify(content, null, 2) };
        }

        case "fill_form": {
          if (!action.options?.fields) return { success: false, error: "Fields required" };
          const fields = action.options.fields as Array<{ selector: string; value: string }>;
          for (const field of fields) {
            await page.waitForSelector(field.selector, { timeout: 5000 });
            await page.click(field.selector, { clickCount: 3 }); // Select all
            await page.type(field.selector, field.value);
          }
          return { success: true, data: `Filled ${fields.length} form fields` };
        }

        default:
          return { success: false, error: `Unknown action: ${action.action}` };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async closePage(sessionId: string): Promise<void> {
    const page = this.pages.get(sessionId);
    if (page) {
      await page.close().catch(() => {});
      this.pages.delete(sessionId);
    }
  }

  async destroy(): Promise<void> {
    for (const page of this.pages.values()) {
      await page.close().catch(() => {});
    }
    this.pages.clear();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
