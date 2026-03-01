/**
 * AstraOS — Computer Use Engine
 * Real desktop + browser GUI automation.
 * Browser: Puppeteer CDP (mouse, keyboard, screenshot)
 * Desktop: native OS input via child_process (xdotool / cliclick / PowerShell)
 * Falls back gracefully when desktop tools are unavailable.
 */

import { BrowserEngine } from "./BrowserEngine";
import { logger } from "../utils/logger";
import { execSync } from "child_process";
import * as os from "os";

export type ComputerAction =
  | { action: "screenshot" }
  | { action: "click"; coordinate: [number, number] }
  | { action: "double_click"; coordinate: [number, number] }
  | { action: "right_click"; coordinate: [number, number] }
  | { action: "type"; text: string }
  | { action: "key"; key_combo: string }
  | { action: "scroll"; coordinate: [number, number]; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { action: "cursor_position" }
  | { action: "drag"; start: [number, number]; end: [number, number] }
  | { action: "wait"; ms: number };

export interface ComputerResult {
  success: boolean;
  screenshot?: string;
  cursorPosition?: [number, number];
  error?: string;
  mode: "browser" | "desktop";
}

type DesktopBackend = "xdotool" | "cliclick" | "powershell" | "none";

export class ComputerUseEngine {
  private browser: BrowserEngine;
  private desktopBackend: DesktopBackend;
  private platform: string;

  constructor(browser: BrowserEngine) {
    this.browser = browser;
    this.platform = os.platform();
    this.desktopBackend = this.detectDesktopBackend();
    logger.info(`[ComputerUse] Platform: ${this.platform}, desktop backend: ${this.desktopBackend}`);
  }

  private detectDesktopBackend(): DesktopBackend {
    try {
      if (this.platform === "linux") {
        execSync("which xdotool", { stdio: "pipe" });
        return "xdotool";
      } else if (this.platform === "darwin") {
        execSync("which cliclick", { stdio: "pipe" });
        return "cliclick";
      } else if (this.platform === "win32") {
        return "powershell";
      }
    } catch { /* tool not found */ }
    return "none";
  }

  get hasDesktopSupport(): boolean {
    return this.desktopBackend !== "none";
  }

  async execute(sessionId: string, action: ComputerAction, preferDesktop = false): Promise<ComputerResult> {
    const useDesktop = preferDesktop && this.hasDesktopSupport;
    try {
      switch (action.action) {
        case "screenshot":
          return useDesktop ? this.desktopScreenshot() : this.browserScreenshot(sessionId);
        case "click":
          return useDesktop ? this.desktopClick(action.coordinate) : this.browserClick(sessionId, action.coordinate);
        case "double_click":
          return useDesktop ? this.desktopDoubleClick(action.coordinate) : this.browserDoubleClick(sessionId, action.coordinate);
        case "right_click":
          return useDesktop ? this.desktopRightClick(action.coordinate) : this.browserRightClick(sessionId, action.coordinate);
        case "type":
          return useDesktop ? this.desktopType(action.text) : this.browserType(sessionId, action.text);
        case "key":
          return useDesktop ? this.desktopKey(action.key_combo) : this.browserKey(sessionId, action.key_combo);
        case "scroll":
          return useDesktop
            ? this.desktopScroll(action.coordinate, action.direction, action.amount || 3)
            : this.browserScroll(sessionId, action.direction);
        case "cursor_position":
          return useDesktop ? this.desktopCursorPosition() : { success: true, cursorPosition: [0, 0], mode: "browser" };
        case "drag":
          return useDesktop ? this.desktopDrag(action.start, action.end) : this.browserDrag(sessionId, action.start, action.end);
        case "wait":
          await new Promise((r) => setTimeout(r, Math.min(action.ms, 10_000)));
          return { success: true, mode: useDesktop ? "desktop" : "browser" };
        default:
          return { success: false, error: `Unknown action: ${(action as ComputerAction).action}`, mode: "browser" };
      }
    } catch (err) {
      logger.error(`[ComputerUse] ${action.action} failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message, mode: useDesktop ? "desktop" : "browser" };
    }
  }

  // ─── Desktop: Real OS-level input ───

  private desktopScreenshot(): ComputerResult {
    const ts = Date.now();
    let base64: string;
    if (this.desktopBackend === "xdotool") {
      const tmp = `/tmp/astra_ss_${ts}.png`;
      try { execSync(`scrot ${tmp}`, { stdio: "pipe" }); } catch { execSync(`import -window root ${tmp}`, { stdio: "pipe" }); }
      base64 = execSync(`base64 -w0 ${tmp}`, { stdio: "pipe" }).toString();
      execSync(`rm -f ${tmp}`, { stdio: "pipe" });
    } else if (this.desktopBackend === "cliclick") {
      const tmp = `/tmp/astra_ss_${ts}.png`;
      execSync(`screencapture -x ${tmp}`, { stdio: "pipe" });
      base64 = execSync(`base64 -i ${tmp}`, { stdio: "pipe" }).toString().replace(/\s/g, "");
      execSync(`rm -f ${tmp}`, { stdio: "pipe" });
    } else {
      const tmp = `${process.env.TEMP || "C:\\Temp"}\\astra_ss_${ts}.png`;
      execSync(`powershell -Command "Add-Type -A System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${tmp}'); [Convert]::ToBase64String([IO.File]::ReadAllBytes('${tmp}'))"`, { stdio: "pipe", timeout: 10_000 });
      base64 = execSync(`powershell -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('${tmp}'))"`, { stdio: "pipe" }).toString().trim();
      try { execSync(`del "${tmp}"`, { stdio: "pipe" }); } catch { /* best-effort cleanup */ }
    }
    return { success: true, screenshot: base64, mode: "desktop" };
  }

  private desktopClick([x, y]: [number, number]): ComputerResult {
    if (this.desktopBackend === "xdotool") execSync(`xdotool mousemove ${x} ${y} click 1`, { stdio: "pipe" });
    else if (this.desktopBackend === "cliclick") execSync(`cliclick c:${x},${y}`, { stdio: "pipe" });
    else this.psMouseEvent(x, y, "2,0,0,0,0", "4,0,0,0,0");
    return { success: true, mode: "desktop" };
  }

  private desktopDoubleClick([x, y]: [number, number]): ComputerResult {
    if (this.desktopBackend === "xdotool") execSync(`xdotool mousemove ${x} ${y} click --repeat 2 1`, { stdio: "pipe" });
    else if (this.desktopBackend === "cliclick") execSync(`cliclick dc:${x},${y}`, { stdio: "pipe" });
    else { this.desktopClick([x, y]); this.desktopClick([x, y]); }
    return { success: true, mode: "desktop" };
  }

  private desktopRightClick([x, y]: [number, number]): ComputerResult {
    if (this.desktopBackend === "xdotool") execSync(`xdotool mousemove ${x} ${y} click 3`, { stdio: "pipe" });
    else if (this.desktopBackend === "cliclick") execSync(`cliclick rc:${x},${y}`, { stdio: "pipe" });
    else this.psMouseEvent(x, y, "8,0,0,0,0", "16,0,0,0,0");
    return { success: true, mode: "desktop" };
  }

  private desktopType(text: string): ComputerResult {
    if (this.desktopBackend === "xdotool") {
      execSync(`xdotool type --delay 12 -- ${JSON.stringify(text)}`, { stdio: "pipe", timeout: 30_000 });
    } else if (this.desktopBackend === "cliclick") {
      execSync(`cliclick t:${JSON.stringify(text)}`, { stdio: "pipe", timeout: 30_000 });
    } else {
      const escaped = text.replace(/[+^%~(){}[\]]/g, "{$&}");
      execSync(`powershell -Command "Add-Type -A System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')"`, { stdio: "pipe", timeout: 30_000 });
    }
    return { success: true, mode: "desktop" };
  }

  private desktopKey(combo: string): ComputerResult {
    if (this.desktopBackend === "xdotool") {
      execSync(`xdotool key ${combo}`, { stdio: "pipe" });
    } else if (this.desktopBackend === "cliclick") {
      execSync(`cliclick kp:${combo}`, { stdio: "pipe" });
    } else {
      const map: Record<string, string> = {
        enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", backspace: "{BACKSPACE}",
        "ctrl+c": "^c", "ctrl+v": "^v", "ctrl+a": "^a", "ctrl+z": "^z", "ctrl+s": "^s",
        "alt+f4": "%{F4}", "alt+tab": "%{TAB}",
      };
      const key = map[combo.toLowerCase()] || `{${combo.toUpperCase()}}`;
      execSync(`powershell -Command "Add-Type -A System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')"`, { stdio: "pipe", timeout: 5000 });
    }
    return { success: true, mode: "desktop" };
  }

  private desktopScroll([x, y]: [number, number], direction: string, amount: number): ComputerResult {
    if (this.desktopBackend === "xdotool") {
      const btn = direction === "up" ? 4 : direction === "down" ? 5 : direction === "left" ? 6 : 7;
      execSync(`xdotool mousemove ${x} ${y} click --repeat ${amount} ${btn}`, { stdio: "pipe" });
    } else if (this.desktopBackend === "cliclick") {
      execSync(`cliclick m:${x},${y}`, { stdio: "pipe" });
    } else {
      const delta = (direction === "up" || direction === "left") ? amount * 120 : -(amount * 120);
      this.psExec(`$s=Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int i);' -Name W -Namespace W -PassThru; $s::mouse_event(0x0800,0,0,${delta},0)`);
    }
    return { success: true, mode: "desktop" };
  }

  private desktopCursorPosition(): ComputerResult {
    let x = 0, y = 0;
    if (this.desktopBackend === "xdotool") {
      const out = execSync("xdotool getmouselocation --shell", { stdio: "pipe" }).toString();
      x = parseInt(out.match(/X=(\d+)/)?.[1] || "0");
      y = parseInt(out.match(/Y=(\d+)/)?.[1] || "0");
    } else if (this.desktopBackend === "cliclick") {
      const parts = execSync("cliclick p:", { stdio: "pipe" }).toString().trim().split(",");
      if (parts.length === 2) { x = parseInt(parts[0]); y = parseInt(parts[1]); }
    } else {
      const out = this.psExec("Add-Type -A System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; Write-Output \"$($p.X),$($p.Y)\"");
      const parts = out.trim().split(",");
      if (parts.length === 2) { x = parseInt(parts[0]); y = parseInt(parts[1]); }
    }
    return { success: true, cursorPosition: [x, y], mode: "desktop" };
  }

  private desktopDrag(start: [number, number], end: [number, number]): ComputerResult {
    if (this.desktopBackend === "xdotool") {
      execSync(`xdotool mousemove ${start[0]} ${start[1]} mousedown 1 mousemove --delay 50 ${end[0]} ${end[1]} mouseup 1`, { stdio: "pipe" });
    } else if (this.desktopBackend === "cliclick") {
      execSync(`cliclick dd:${start[0]},${start[1]} du:${end[0]},${end[1]}`, { stdio: "pipe" });
    } else {
      this.psExec(`$s=Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int i);[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);' -Name W -Namespace W -PassThru; $s::SetCursorPos(${start[0]},${start[1]}); Start-Sleep -M 50; $s::mouse_event(2,0,0,0,0); $s::SetCursorPos(${end[0]},${end[1]}); Start-Sleep -M 50; $s::mouse_event(4,0,0,0,0)`);
    }
    return { success: true, mode: "desktop" };
  }

  private psMouseEvent(x: number, y: number, ...events: string[]): void {
    const evts = events.map((e) => `$s::mouse_event(${e})`).join("; ");
    this.psExec(`Add-Type -A System.Windows.Forms; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y}); $s=Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int i);' -Name W -Namespace W -PassThru; ${evts}`);
  }

  private psExec(cmd: string): string {
    return execSync(`powershell -Command "${cmd}"`, { stdio: "pipe", timeout: 5000 }).toString();
  }

  // ─── Browser: Puppeteer CDP ───

  private async browserScreenshot(sessionId: string): Promise<ComputerResult> {
    const r = await this.browser.execute(sessionId, { action: "screenshot" });
    return { success: true, screenshot: r.screenshot?.toString("base64") || r.data, mode: "browser" };
  }

  private async browserClick(sessionId: string, [x, y]: [number, number]): Promise<ComputerResult> {
    await this.browser.execute(sessionId, { action: "evaluate", script: `document.elementFromPoint(${x},${y})?.click(); 'ok'` });
    const r = await this.browser.execute(sessionId, { action: "screenshot" });
    return { success: true, screenshot: r.screenshot?.toString("base64") || r.data, mode: "browser" };
  }

  private async browserDoubleClick(sessionId: string, [x, y]: [number, number]): Promise<ComputerResult> {
    await this.browser.execute(sessionId, { action: "evaluate", script: `document.elementFromPoint(${x},${y})?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:${x},clientY:${y}})); 'ok'` });
    return { success: true, mode: "browser" };
  }

  private async browserRightClick(sessionId: string, [x, y]: [number, number]): Promise<ComputerResult> {
    await this.browser.execute(sessionId, { action: "evaluate", script: `document.elementFromPoint(${x},${y})?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:${x},clientY:${y}})); 'ok'` });
    return { success: true, mode: "browser" };
  }

  private async browserType(sessionId: string, text: string): Promise<ComputerResult> {
    await this.browser.execute(sessionId, { action: "evaluate", script: `(()=>{const e=document.activeElement;if(e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable)){e.value=(e.value||'')+${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}return 'ok'})()` });
    return { success: true, mode: "browser" };
  }

  private async browserKey(sessionId: string, combo: string): Promise<ComputerResult> {
    await this.browser.execute(sessionId, { action: "evaluate", script: `document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(combo)},bubbles:true})); 'ok'` });
    return { success: true, mode: "browser" };
  }

  private async browserScroll(sessionId: string, direction: string): Promise<ComputerResult> {
    const map: Record<string, string> = { up: "0,-300", down: "0,300", left: "-300,0", right: "300,0" };
    await this.browser.execute(sessionId, { action: "evaluate", script: `window.scrollBy(${map[direction]}); 'ok'` });
    const r = await this.browser.execute(sessionId, { action: "screenshot" });
    return { success: true, screenshot: r.screenshot?.toString("base64") || r.data, mode: "browser" };
  }

  private async browserDrag(sessionId: string, start: [number, number], end: [number, number]): Promise<ComputerResult> {
    await this.browser.execute(sessionId, { action: "evaluate", script: `(()=>{const e=document.elementFromPoint(${start[0]},${start[1]});if(e){e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:${start[0]},clientY:${start[1]}}));document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${end[0]},clientY:${end[1]}}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:${end[0]},clientY:${end[1]}}));}return 'ok'})()` });
    return { success: true, mode: "browser" };
  }
}
