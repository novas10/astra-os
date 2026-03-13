/**
 * AstraOS — i18n (Internationalization) Engine
 * Singleton translation system with interpolation, pluralization, and locale-aware formatting.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface I18nConfig {
  defaultLocale?: string;
  fallbackLocale?: string;
  localesDir?: string;
}

export interface PluralRules {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

type TranslationValue = string | PluralRules | Record<string, any>;
type TranslationMap = Record<string, TranslationValue>;

export class I18n {
  private static instance: I18n | null = null;

  private currentLocale: string;
  private fallbackLocale: string;
  private localesDir: string;
  private translations: Map<string, TranslationMap> = new Map();
  private loadedLocales: Set<string> = new Set();

  private constructor(config?: I18nConfig) {
    this.currentLocale = config?.defaultLocale || "en";
    this.fallbackLocale = config?.fallbackLocale || "en";
    this.localesDir = config?.localesDir || join(__dirname, "locales");
    this.loadLocale(this.fallbackLocale);
    if (this.currentLocale !== this.fallbackLocale) {
      this.loadLocale(this.currentLocale);
    }
  }

  /** Get or create the singleton instance */
  static getInstance(config?: I18nConfig): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n(config);
    }
    return I18n.instance;
  }

  /** Reset the singleton (useful for testing) */
  static reset(): void {
    I18n.instance = null;
  }

  // ─── Core Translation ───

  /**
   * Translate a key with optional interpolation parameters.
   *
   * @example
   * t("greeting", { name: "Kowsi" })  → "Hello, Kowsi!"
   * t("items_count", { count: 3 })    → "3 items" (pluralized)
   */
  t(key: string, params?: Record<string, string | number>): string {
    const value = this.resolve(key);

    if (value === undefined) {
      return key; // Return key as fallback
    }

    // Handle pluralization
    if (typeof value === "object" && !Array.isArray(value) && ("one" in value || "other" in value)) {
      const count = params?.count;
      if (count !== undefined && typeof count === "number") {
        const pluralForm = this.getPluralForm(count, value as PluralRules);
        return this.interpolate(pluralForm, params);
      }
      // No count provided — use "other" form
      return this.interpolate((value as PluralRules).other, params);
    }

    if (typeof value === "string") {
      return this.interpolate(value, params);
    }

    return key;
  }

  /**
   * Check if a translation key exists.
   */
  has(key: string): boolean {
    return this.resolve(key) !== undefined;
  }

  // ─── Locale Management ───

  /** Get the current locale */
  getLocale(): string {
    return this.currentLocale;
  }

  /** Set the current locale */
  setLocale(locale: string): void {
    this.loadLocale(locale);
    this.currentLocale = locale;
  }

  /**
   * Detect locale from various sources in priority order:
   * 1. Explicit user preference
   * 2. Accept-Language header
   * 3. Config/environment
   * 4. Default fallback
   */
  detectLocale(options?: {
    userPreference?: string;
    acceptLanguage?: string;
    envLocale?: string;
  }): string {
    // 1. Explicit user preference
    if (options?.userPreference) {
      const normalized = this.normalizeLocale(options.userPreference);
      if (this.isLocaleAvailable(normalized)) return normalized;
      // Try language-only fallback (e.g., "en-GB" → "en")
      const lang = normalized.split("-")[0];
      if (this.isLocaleAvailable(lang)) return lang;
    }

    // 2. Accept-Language header parsing
    if (options?.acceptLanguage) {
      const detected = this.parseAcceptLanguage(options.acceptLanguage);
      if (detected) return detected;
    }

    // 3. Environment variable
    if (options?.envLocale) {
      const normalized = this.normalizeLocale(options.envLocale);
      if (this.isLocaleAvailable(normalized)) return normalized;
    }

    // 4. Process environment
    const envLang = process.env.ASTRA_LOCALE || process.env.LANG;
    if (envLang) {
      const normalized = this.normalizeLocale(envLang.split(".")[0]);
      if (this.isLocaleAvailable(normalized)) return normalized;
    }

    return this.fallbackLocale;
  }

  /** Get list of available locales */
  getAvailableLocales(): string[] {
    const locales: string[] = [];
    const fs = require("fs");
    try {
      const files: string[] = fs.readdirSync(this.localesDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          locales.push(file.replace(".json", ""));
        }
      }
    } catch {
      // Directory may not exist
    }
    return locales;
  }

  // ─── Formatting ───

  /** Format a number according to the current locale */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.toIntlLocale(this.currentLocale), options).format(value);
  }

  /** Format a currency value */
  formatCurrency(value: number, currency: string = "USD"): string {
    return new Intl.NumberFormat(this.toIntlLocale(this.currentLocale), {
      style: "currency",
      currency,
    }).format(value);
  }

  /** Format a date according to the current locale */
  formatDate(date: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
    const d = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat(this.toIntlLocale(this.currentLocale), options).format(d);
  }

  /** Format a relative time (e.g., "3 days ago") */
  formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return new Intl.RelativeTimeFormat(this.toIntlLocale(this.currentLocale), {
      numeric: "auto",
    }).format(value, unit);
  }

  // ─── Internal Helpers ───

  private loadLocale(locale: string): void {
    if (this.loadedLocales.has(locale)) return;

    const filePath = join(this.localesDir, `${locale}.json`);
    if (!existsSync(filePath)) {
      // Try language-only file (e.g., "en" for "en-US")
      const langOnly = locale.split("-")[0];
      const langPath = join(this.localesDir, `${langOnly}.json`);
      if (langOnly !== locale && existsSync(langPath)) {
        this.loadLocaleFile(locale, langPath);
        return;
      }
      return;
    }

    this.loadLocaleFile(locale, filePath);
  }

  private loadLocaleFile(locale: string, filePath: string): void {
    try {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content) as TranslationMap;
      // Flatten nested objects into dot-notation keys
      const flat = this.flatten(data);
      this.translations.set(locale, flat);
      this.loadedLocales.add(locale);
    } catch {
      // Invalid JSON or read error
    }
  }

  /**
   * Resolve a dotted key through the fallback chain:
   * current locale → region base (e.g., "en" from "en-GB") → fallback locale
   */
  private resolve(key: string): TranslationValue | undefined {
    // 1. Current locale
    const current = this.translations.get(this.currentLocale);
    if (current && key in current) return current[key];

    // 2. Region base locale
    const baseLang = this.currentLocale.split("-")[0];
    if (baseLang !== this.currentLocale) {
      this.loadLocale(baseLang);
      const base = this.translations.get(baseLang);
      if (base && key in base) return base[key];
    }

    // 3. Fallback locale
    if (this.currentLocale !== this.fallbackLocale) {
      const fallback = this.translations.get(this.fallbackLocale);
      if (fallback && key in fallback) return fallback[key];
    }

    return undefined;
  }

  /** Interpolate {{param}} placeholders in a string */
  private interpolate(text: string, params?: Record<string, string | number>): string {
    if (!params) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return key in params ? String(params[key]) : `{{${key}}}`;
    });
  }

  /** Select the correct plural form based on count */
  private getPluralForm(count: number, rules: PluralRules): string {
    // Use Intl.PluralRules for proper CLDR plural categories
    const pr = new Intl.PluralRules(this.toIntlLocale(this.currentLocale));
    const category = pr.select(count);

    switch (category) {
      case "zero":
        return rules.zero || rules.other;
      case "one":
        return rules.one || rules.other;
      case "two":
        return rules.two || rules.other;
      case "few":
        return rules.few || rules.other;
      case "many":
        return rules.many || rules.other;
      default:
        return rules.other;
    }
  }

  /** Flatten a nested object into dot-notation keys */
  private flatten(obj: Record<string, any>, prefix = ""): TranslationMap {
    const result: TranslationMap = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === "string") {
        result[fullKey] = value;
      } else if (typeof value === "object" && value !== null) {
        // Check if it's a plural rules object
        if ("one" in value || "other" in value) {
          result[fullKey] = value as PluralRules;
        } else {
          // Recurse into nested object
          Object.assign(result, this.flatten(value, fullKey));
        }
      }
    }

    return result;
  }

  /** Normalize locale string (e.g., "en_US" → "en-US", "EN" → "en") */
  private normalizeLocale(locale: string): string {
    return locale.replace(/_/g, "-").toLowerCase();
  }

  /** Convert our locale format to Intl-compatible format */
  private toIntlLocale(locale: string): string {
    // Map short codes to full Intl locale tags
    const map: Record<string, string> = {
      en: "en-US",
      hi: "hi-IN",
      ta: "ta-IN",
      zh: "zh-CN",
      ja: "ja-JP",
      es: "es-ES",
      ar: "ar-SA",
    };
    return map[locale] || locale;
  }

  /** Check if a locale file is available */
  private isLocaleAvailable(locale: string): boolean {
    if (this.loadedLocales.has(locale)) return true;
    const filePath = join(this.localesDir, `${locale}.json`);
    return existsSync(filePath);
  }

  /** Parse Accept-Language header and return best matching locale */
  private parseAcceptLanguage(header: string): string | null {
    const entries = header
      .split(",")
      .map((part) => {
        const [lang, qPart] = part.trim().split(";");
        const q = qPart ? parseFloat(qPart.replace("q=", "")) : 1.0;
        return { lang: lang.trim().toLowerCase(), q };
      })
      .sort((a, b) => b.q - a.q);

    for (const { lang } of entries) {
      const normalized = this.normalizeLocale(lang);
      if (this.isLocaleAvailable(normalized)) return normalized;
      const base = normalized.split("-")[0];
      if (this.isLocaleAvailable(base)) return base;
    }

    return null;
  }
}

// ─── Convenience Exports ───

/** Shortcut: get the singleton and translate */
export function t(key: string, params?: Record<string, string | number>): string {
  return I18n.getInstance().t(key, params);
}

/** Initialize i18n with config */
export function initI18n(config?: I18nConfig): I18n {
  I18n.reset();
  return I18n.getInstance(config);
}

export default I18n;
