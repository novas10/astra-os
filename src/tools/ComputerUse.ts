/**
 * AstraOS — Computer Use
 * Screenshot-based GUI automation. Take screenshots, click, type, scroll.
 * Browser via Puppeteer, extensible to desktop via nut-tree.
 */

import { BrowserEngine } from "./BrowserEngine";
import { logger } from "../utils/logger";

export type ComputerAction =
  | { action: "screenshot" }
  | { action: "click"; coordinate: [number, number] }
  | { action: "double_click"; coordinate: [number, number] }
  | { action: "type"; text: string }
  | { action: "key"; key_combo: string }
  | { action: "scroll"; coordinate: [number, number]; direction: "up" | "down" | "left" | "right" }
  | { action: "cursor_position" }
  | { action: "drag"; start: [number, number]; end: [number, number] };

export interface ComputerResult {
  success: boolean;
  screenshot?: string;  // base64 encoded PNG
  cursorPosition?: [number, number];
  error?: string;
}

export class ComputerUseEngine {
  private browser: BrowserEngine;

  constructor(browser: BrowserEngine) {
    this.browser = browser;
  }

  async execute(sessionId: string, action: ComputerAction): Promise<ComputerResult> {
    try {
      switch (action.action) {
        case "screenshot": {
          const result = await this.browser.execute(sessionId, { action: "screenshot" });
          return {
            success: true,
            screenshot: result.screenshot ? result.screenshot.toString("base64") : result.data,
          };
        }

        case "click": {
          const [x, y] = action.coordinate;
          await this.browser.execute(sessionId, {
            action: "evaluate",
            script: `
              document.elementFromPoint(${x}, ${y})?.click();
              'clicked at ${x},${y}'
            `,
          });
          // Take screenshot after click for visual feedback
          const afterClick = await this.browser.execute(sessionId, { action: "screenshot" });
          return { success: true, screenshot: afterClick.screenshot ? afterClick.screenshot.toString("base64") : afterClick.data };
        }

        case "double_click": {
          const [x, y] = action.coordinate;
          await this.browser.execute(sessionId, {
            action: "evaluate",
            script: `
              const el = document.elementFromPoint(${x}, ${y});
              if (el) {
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: ${x}, clientY: ${y} }));
              }
              'double-clicked at ${x},${y}'
            `,
          });
          const afterDblClick = await this.browser.execute(sessionId, { action: "screenshot" });
          return { success: true, screenshot: afterDblClick.screenshot ? afterDblClick.screenshot.toString("base64") : afterDblClick.data };
        }

        case "type": {
          await this.browser.execute(sessionId, {
            action: "evaluate",
            script: `
              const active = document.activeElement;
              if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
                active.value = (active.value || '') + ${JSON.stringify(action.text)};
                active.dispatchEvent(new Event('input', { bubbles: true }));
              }
              'typed: ${action.text.slice(0, 20)}'
            `,
          });
          return { success: true };
        }

        case "key": {
          await this.browser.execute(sessionId, {
            action: "evaluate",
            script: `
              document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(action.key_combo)}, bubbles: true }));
              'key pressed: ${action.key_combo}'
            `,
          });
          return { success: true };
        }

        case "scroll": {
          const scrollMap = { up: "0, -300", down: "0, 300", left: "-300, 0", right: "300, 0" };
          await this.browser.execute(sessionId, {
            action: "evaluate",
            script: `window.scrollBy(${scrollMap[action.direction]}); 'scrolled ${action.direction}'`,
          });
          const afterScroll = await this.browser.execute(sessionId, { action: "screenshot" });
          return { success: true, screenshot: afterScroll.screenshot ? afterScroll.screenshot.toString("base64") : afterScroll.data };
        }

        case "cursor_position": {
          return { success: true, cursorPosition: [0, 0] };
        }

        case "drag": {
          const [sx, sy] = action.start;
          const [ex, ey] = action.end;
          await this.browser.execute(sessionId, {
            action: "evaluate",
            script: `
              const startEl = document.elementFromPoint(${sx}, ${sy});
              if (startEl) {
                startEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ${sx}, clientY: ${sy} }));
                document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${ex}, clientY: ${ey} }));
                document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${ex}, clientY: ${ey} }));
              }
              'dragged from ${sx},${sy} to ${ex},${ey}'
            `,
          });
          return { success: true };
        }

        default:
          return { success: false, error: `Unknown action: ${(action as ComputerAction).action}` };
      }
    } catch (err) {
      logger.error(`[ComputerUse] Action failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }
}
