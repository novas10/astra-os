/**
 * AstraOS — Daily Digest Service
 * Auto-compiles and sends personalized morning briefings via Telegram.
 * Fetches weather, news, crypto, tasks, and quotes from free APIs.
 */

import { logger } from "../utils/logger";
import * as fs from "fs";
import * as path from "path";

export interface DigestConfig {
  city: string;
  timezone: string;
  cryptoCoins: string[];
  newsCategories: string[];
  userName: string;
  telegramChatId: string;
  telegramBotToken: string;
  digestTime: string; // HH:MM format
  enabled: boolean;
}

interface WeatherData {
  temp: string;
  condition: string;
  high: string;
  low: string;
  humidity: string;
  wind: string;
  feelsLike: string;
}

interface CryptoPrice {
  name: string;
  symbol: string;
  priceUsd: string;
  priceInr: string;
  change24h: string;
}

interface NewsItem {
  title: string;
  source: string;
}

const DEFAULT_CONFIG: DigestConfig = {
  city: "Coimbatore",
  timezone: "Asia/Kolkata",
  cryptoCoins: ["bitcoin", "ethereum", "solana", "binancecoin"],
  newsCategories: ["technology", "business"],
  userName: "Boss",
  telegramChatId: "",
  telegramBotToken: "",
  digestTime: "08:00",
  enabled: true,
};

export class DailyDigest {
  private config: DigestConfig;
  private configPath: string;
  private digestDir: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.configPath = path.join(process.cwd(), "workspace", "digest-config.json");
    this.digestDir = path.join(process.cwd(), "workspace", "digests");
    this.config = this.loadConfig();
  }

  private loadConfig(): DigestConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      logger.warn("[DailyDigest] Failed to load config, using defaults");
    }
    return {
      ...DEFAULT_CONFIG,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    };
  }

  saveConfig(updates: Partial<DigestConfig>): void {
    this.config = { ...this.config, ...updates };
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    logger.info("[DailyDigest] Config saved");
  }

  getConfig(): DigestConfig {
    return { ...this.config };
  }

  /** Start the daily digest scheduler */
  start(): void {
    if (!this.config.telegramBotToken) {
      this.config.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || "";
    }

    if (!this.config.telegramChatId) {
      logger.info("[DailyDigest] No Telegram chat ID configured. Send /digest to the bot to register.");
      return;
    }

    if (!this.config.enabled) {
      logger.info("[DailyDigest] Digest is disabled");
      return;
    }

    // Check every minute if it's time to send
    this.timer = setInterval(() => {
      this.checkAndSend();
    }, 60_000);

    logger.info(`[DailyDigest] Scheduler started — digest at ${this.config.digestTime} for ${this.config.city}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private checkAndSend(): void {
    const now = new Date().toLocaleString("en-US", { timeZone: this.config.timezone });
    const currentTime = new Date(now);
    const [targetH, targetM] = this.config.digestTime.split(":").map(Number);

    if (currentTime.getHours() === targetH && currentTime.getMinutes() === targetM) {
      this.compileAndSend().catch((err) => {
        logger.error(`[DailyDigest] Failed to send: ${(err as Error).message}`);
      });
    }
  }

  /** Compile all digest sections and send via Telegram */
  async compileAndSend(): Promise<string> {
    logger.info("[DailyDigest] Compiling daily digest...");

    const sections = await Promise.allSettled([
      this.fetchWeather(),
      this.fetchNews(),
      this.fetchCrypto(),
      this.fetchTasks(),
      this.fetchQuote(),
      this.fetchGoldSilver(),
      this.fetchForex(),
    ]);

    const weather = sections[0].status === "fulfilled" ? sections[0].value : null;
    const news = sections[1].status === "fulfilled" ? sections[1].value : null;
    const crypto = sections[2].status === "fulfilled" ? sections[2].value : null;
    const tasks = sections[3].status === "fulfilled" ? sections[3].value : null;
    const quote = sections[4].status === "fulfilled" ? sections[4].value : null;
    const metals = sections[5].status === "fulfilled" ? sections[5].value : null;
    const forex = sections[6].status === "fulfilled" ? sections[6].value : null;

    const now = new Date().toLocaleString("en-US", { timeZone: this.config.timezone });
    const date = new Date(now);
    const dayName = date.toLocaleDateString("en-US", { weekday: "long", timeZone: this.config.timezone });
    const dateStr = date.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: this.config.timezone });
    const greeting = this.getGreeting(date.getHours());

    let digest = `${greeting}, ${this.config.userName}!\n`;
    digest += `${dayName}, ${dateStr}\n`;
    digest += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Weather
    if (weather) {
      digest += `🌤 WEATHER — ${this.config.city}\n`;
      digest += `  ${weather.temp}°C | ${weather.condition}\n`;
      digest += `  Feels like: ${weather.feelsLike}°C\n`;
      digest += `  High: ${weather.high}°C | Low: ${weather.low}°C\n`;
      digest += `  Humidity: ${weather.humidity}% | Wind: ${weather.wind} km/h\n\n`;
    }

    // News
    if (news && news.length > 0) {
      digest += `📰 TOP NEWS\n`;
      news.forEach((item, i) => {
        digest += `  ${i + 1}. ${item.title}\n     — ${item.source}\n`;
      });
      digest += `\n`;
    }

    // Gold & Silver
    if (metals) {
      digest += `🥇 GOLD & SILVER\n`;
      digest += `  Gold:   $${metals.goldUsd}/oz | ₹${metals.goldInr}/10g\n`;
      digest += `  Silver: $${metals.silverUsd}/oz | ₹${metals.silverInr}/kg\n\n`;
    }

    // Crypto
    if (crypto && crypto.length > 0) {
      digest += `🪙 CRYPTO\n`;
      crypto.forEach((coin) => {
        const arrow = parseFloat(coin.change24h) >= 0 ? "▲" : "▼";
        digest += `  ${coin.symbol}: $${coin.priceUsd} (${arrow}${coin.change24h}%)\n`;
        digest += `    ₹${coin.priceInr}\n`;
      });
      digest += `\n`;
    }

    // Forex Rates
    if (forex) {
      digest += `💱 FOREX (1 USD =)\n`;
      digest += `  INR: ₹${forex.INR}\n`;
      digest += `  EUR: €${forex.EUR}\n`;
      digest += `  GBP: £${forex.GBP}\n`;
      digest += `  JPY: ¥${forex.JPY}\n`;
      digest += `  AED: ${forex.AED} AED\n\n`;
    }

    // Tasks
    if (tasks) {
      digest += `📋 YOUR TASKS\n`;
      digest += tasks;
      digest += `\n`;
    }

    // Quote
    if (quote) {
      digest += `💡 QUOTE OF THE DAY\n`;
      digest += `  "${quote.text}"\n  — ${quote.author}\n\n`;
    }

    digest += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    digest += `Have a productive day! 🚀`;

    // Save digest to file
    this.saveDigest(digest, dateStr);

    // Send via Telegram
    if (this.config.telegramChatId && this.config.telegramBotToken) {
      await this.sendTelegram(digest);
      logger.info("[DailyDigest] Digest sent to Telegram");
    }

    return digest;
  }

  private getGreeting(hour: number): string {
    if (hour < 12) return "☀️ Good Morning";
    if (hour < 17) return "🌤 Good Afternoon";
    if (hour < 21) return "🌆 Good Evening";
    return "🌙 Good Night";
  }

  // ── Data Fetchers ──

  private async fetchWeather(): Promise<WeatherData> {
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(this.config.city)}?format=j1`);
    if (!resp.ok) throw new Error(`Weather API returned ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const current = (data.current_condition as Record<string, unknown>[])?.[0];
    const today = (data.weather as Record<string, unknown>[])?.[0];

    return {
      temp: String((current as Record<string, unknown>)?.temp_C || "?"),
      condition: String(((current as Record<string, unknown>)?.weatherDesc as Array<Record<string, string>>)?.[0]?.value || "Unknown"),
      feelsLike: String((current as Record<string, unknown>)?.FeelsLikeC || "?"),
      high: String((today as Record<string, unknown>)?.maxtempC || "?"),
      low: String((today as Record<string, unknown>)?.mintempC || "?"),
      humidity: String((current as Record<string, unknown>)?.humidity || "?"),
      wind: String((current as Record<string, unknown>)?.windspeedKmph || "?"),
    };
  }

  private async fetchNews(): Promise<NewsItem[]> {
    // Use DuckDuckGo instant answers for news (no API key needed)
    try {
      const resp = await fetch("https://lite.duckduckgo.com/lite/?q=top+tech+news+today&kl=in-en", {
        headers: { "User-Agent": "AstraOS/4.0" },
      });
      if (!resp.ok) throw new Error("News fetch failed");
      const html = await resp.text();

      // Parse simple results from DDG lite
      const items: NewsItem[] = [];
      const titleRegex = /<a[^>]*class="result-link"[^>]*>([^<]+)<\/a>/g;
      const sourceRegex = /<span class="link-text">([^<]+)<\/span>/g;
      let match;
      const titles: string[] = [];
      const sources: string[] = [];

      while ((match = titleRegex.exec(html)) !== null && titles.length < 5) {
        titles.push(match[1].trim());
      }
      while ((match = sourceRegex.exec(html)) !== null && sources.length < 5) {
        sources.push(match[1].trim());
      }

      for (let i = 0; i < Math.min(titles.length, 5); i++) {
        items.push({ title: titles[i], source: sources[i] || "Web" });
      }

      if (items.length === 0) {
        // Fallback: generate placeholder news
        return [
          { title: "Check latest news at your preferred source", source: "Tip" },
        ];
      }
      return items;
    } catch {
      return [
        { title: "News fetch unavailable — check news.google.com", source: "Tip" },
      ];
    }
  }

  private async fetchCrypto(): Promise<CryptoPrice[]> {
    const ids = this.config.cryptoCoins.join(",");
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,inr&include_24hr_change=true`
    );
    if (!resp.ok) throw new Error(`CoinGecko API returned ${resp.status}`);
    const data = await resp.json() as Record<string, Record<string, number>>;

    return Object.entries(data).map(([id, info]) => ({
      name: id.charAt(0).toUpperCase() + id.slice(1),
      symbol: ({ bitcoin: "BTC", ethereum: "ETH", solana: "SOL", binancecoin: "BNB", ripple: "XRP", cardano: "ADA", dogecoin: "DOGE" } as Record<string, string>)[id] || id.toUpperCase().slice(0, 4),
      priceUsd: (info.usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }),
      priceInr: (info.inr || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
      change24h: (info.usd_24h_change || 0).toFixed(2),
    }));
  }

  private async fetchTasks(): Promise<string> {
    const tasksPath = path.join(process.cwd(), "workspace", "tasks.json");
    try {
      if (!fs.existsSync(tasksPath)) return "  No tasks scheduled. Use the smart-scheduler skill to add tasks.\n";
      const raw = fs.readFileSync(tasksPath, "utf-8");
      const tasks = JSON.parse(raw) as Array<{ title: string; priority: string; status: string; due?: string }>;
      const pending = tasks.filter((t) => t.status !== "completed");

      if (pending.length === 0) return "  All tasks completed! 🎉\n";

      let text = "";
      const high = pending.filter((t) => t.priority === "high");
      const medium = pending.filter((t) => t.priority === "medium");
      const low = pending.filter((t) => t.priority === "low" || !t.priority);

      for (const t of high) text += `  🔴 ${t.title}${t.due ? ` (due: ${t.due})` : ""}\n`;
      for (const t of medium) text += `  🟡 ${t.title}${t.due ? ` (due: ${t.due})` : ""}\n`;
      for (const t of low) text += `  ⚪ ${t.title}${t.due ? ` (due: ${t.due})` : ""}\n`;
      text += `  Total: ${pending.length} pending tasks\n`;
      return text;
    } catch {
      return "  Could not load tasks.\n";
    }
  }

  private async fetchQuote(): Promise<{ text: string; author: string }> {
    try {
      const resp = await fetch("https://api.quotable.io/random?maxLength=120");
      if (resp.ok) {
        const data = (await resp.json()) as { content: string; author: string };
        return { text: data.content, author: data.author };
      }
    } catch {
      // Ignore — use fallback
    }

    // Fallback quotes
    const quotes = [
      { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
      { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
      { text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
      { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
      { text: "Code is like humor. When you have to explain it, it's bad.", author: "Cory House" },
      { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
      { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
      { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
      { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
      { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
    ];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  private async fetchGoldSilver(): Promise<{ goldUsd: string; goldInr: string; silverUsd: string; silverInr: string }> {
    // Fetch gold and silver prices from free metals API
    try {
      const resp = await fetch("https://api.metalpriceapi.com/v1/latest?api_key=demo&base=USD&currencies=XAU,XAG,INR");
      if (resp.ok) {
        const data = (await resp.json()) as { rates: Record<string, number> };
        const goldOzUsd = data.rates?.XAU ? (1 / data.rates.XAU) : 0;
        const silverOzUsd = data.rates?.XAG ? (1 / data.rates.XAG) : 0;
        const usdToInr = data.rates?.INR || 83.5;
        // Gold: 1 troy oz = 31.1g, India quotes per 10g
        const goldPerGramInr = (goldOzUsd * usdToInr) / 31.1035;
        const goldPer10gInr = goldPerGramInr * 10;
        // Silver: India quotes per kg
        const silverPerKgInr = (silverOzUsd * usdToInr / 31.1035) * 1000;
        return {
          goldUsd: goldOzUsd.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          goldInr: goldPer10gInr.toLocaleString("en-IN", { maximumFractionDigits: 0 }),
          silverUsd: silverOzUsd.toLocaleString("en-US", { maximumFractionDigits: 2 }),
          silverInr: silverPerKgInr.toLocaleString("en-IN", { maximumFractionDigits: 0 }),
        };
      }
    } catch {
      // Fallback — try CoinGecko for gold/silver proxy
    }
    // Fallback: fetch from alternative free API
    try {
      const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether-gold,silver-token&vs_currencies=usd,inr");
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, Record<string, number>>;
        const gold = data["tether-gold"] || {};
        return {
          goldUsd: (gold.usd || 2650).toLocaleString("en-US", { maximumFractionDigits: 0 }),
          goldInr: ((gold.usd || 2650) * 83.5 / 31.1035 * 10).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
          silverUsd: "31.50",
          silverInr: ((31.5 * 83.5 / 31.1035) * 1000).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
        };
      }
    } catch {
      // Use static fallback
    }
    return { goldUsd: "N/A", goldInr: "N/A", silverUsd: "N/A", silverInr: "N/A" };
  }

  private async fetchForex(): Promise<Record<string, string>> {
    const resp = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    if (!resp.ok) throw new Error(`Forex API returned ${resp.status}`);
    const data = (await resp.json()) as { rates: Record<string, number> };
    const rates = data.rates || {};
    return {
      INR: (rates.INR || 0).toFixed(2),
      EUR: (rates.EUR || 0).toFixed(4),
      GBP: (rates.GBP || 0).toFixed(4),
      JPY: (rates.JPY || 0).toFixed(2),
      AED: (rates.AED || 0).toFixed(2),
      SGD: (rates.SGD || 0).toFixed(4),
      AUD: (rates.AUD || 0).toFixed(4),
      CAD: (rates.CAD || 0).toFixed(4),
    };
  }

  // ── Telegram ──

  private async sendTelegram(text: string): Promise<void> {
    const token = this.config.telegramBotToken;
    const chatId = this.config.telegramChatId;
    if (!token || !chatId) return;

    // Split long messages (Telegram limit: 4096 chars)
    const chunks = this.splitMessage(text, 4000);
    for (const chunk of chunks) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
    }
  }

  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt === -1) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }

  // ── Storage ──

  private saveDigest(digest: string, dateStr: string): void {
    try {
      if (!fs.existsSync(this.digestDir)) fs.mkdirSync(this.digestDir, { recursive: true });
      const filename = `digest-${dateStr.replace(/[^a-zA-Z0-9]/g, "-")}.txt`;
      fs.writeFileSync(path.join(this.digestDir, filename), digest);
    } catch {
      // Non-critical — ignore save errors
    }
  }
}
