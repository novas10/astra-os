import { useQuery } from "@tanstack/react-query";
import {
  Globe, Languages, Calendar, Hash, Search,
  CheckCircle, AlertTriangle, Clock,
} from "lucide-react";
import { useState, useMemo } from "react";

interface LocaleInfo {
  code: string;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  coverage: number;
  translatedKeys: number;
  totalKeys: number;
  lastUpdated: string;
}

interface TranslationEntry {
  key: string;
  en: string;
  [locale: string]: string;
}

const MOCK_LOCALES: LocaleInfo[] = [
  { code: "en", name: "English", nativeName: "English", direction: "ltr", coverage: 100, translatedKeys: 342, totalKeys: 342, lastUpdated: "2026-03-13T08:00:00Z" },
  { code: "hi", name: "Hindi", nativeName: "\u0939\u093f\u0928\u094d\u0926\u0940", direction: "ltr", coverage: 94, translatedKeys: 321, totalKeys: 342, lastUpdated: "2026-03-10T14:00:00Z" },
  { code: "ta", name: "Tamil", nativeName: "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd", direction: "ltr", coverage: 88, translatedKeys: 301, totalKeys: 342, lastUpdated: "2026-03-08T10:00:00Z" },
  { code: "zh", name: "Chinese", nativeName: "\u4e2d\u6587", direction: "ltr", coverage: 96, translatedKeys: 328, totalKeys: 342, lastUpdated: "2026-03-12T16:00:00Z" },
  { code: "ja", name: "Japanese", nativeName: "\u65e5\u672c\u8a9e", direction: "ltr", coverage: 91, translatedKeys: 311, totalKeys: 342, lastUpdated: "2026-03-09T12:00:00Z" },
  { code: "es", name: "Spanish", nativeName: "Espa\u00f1ol", direction: "ltr", coverage: 97, translatedKeys: 332, totalKeys: 342, lastUpdated: "2026-03-11T18:00:00Z" },
  { code: "ar", name: "Arabic", nativeName: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", direction: "rtl", coverage: 82, translatedKeys: 280, totalKeys: 342, lastUpdated: "2026-03-07T09:00:00Z" },
];

const MOCK_TRANSLATIONS: TranslationEntry[] = [
  { key: "app.title", en: "AstraOS Dashboard", hi: "AstraOS \u0921\u0948\u0936\u092c\u094b\u0930\u094d\u0921", ta: "AstraOS \u0b9f\u0bbe\u0bb7\u0bcd\u0baa\u0bcb\u0bb0\u0bcd\u0b9f\u0bcd", zh: "AstraOS \u4eea\u8868\u677f", ja: "AstraOS \u30c0\u30c3\u30b7\u30e5\u30dc\u30fc\u30c9", es: "Panel de AstraOS", ar: "\u0644\u0648\u062d\u0629 \u0642\u064a\u0627\u062f\u0629 AstraOS" },
  { key: "nav.agents", en: "Agents", hi: "\u090f\u091c\u0947\u0902\u091f", ta: "\u0b8f\u0b9c\u0bc6\u0ba3\u0bcd\u0b9f\u0bcd\u0b95\u0bb3\u0bcd", zh: "\u4ee3\u7406", ja: "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8", es: "Agentes", ar: "\u0627\u0644\u0648\u0643\u0644\u0627\u0621" },
  { key: "nav.skills", en: "Skills", hi: "\u0915\u094c\u0936\u0932", ta: "\u0ba4\u0bbf\u0bb1\u0ba9\u0bcd\u0b95\u0bb3\u0bcd", zh: "\u6280\u80fd", ja: "\u30b9\u30ad\u30eb", es: "Habilidades", ar: "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062a" },
  { key: "nav.settings", en: "Settings", hi: "\u0938\u0947\u091f\u093f\u0902\u0917\u094d\u0938", ta: "\u0b85\u0bae\u0bc8\u0baa\u0bcd\u0baa\u0bc1\u0b95\u0bb3\u0bcd", zh: "\u8bbe\u7f6e", ja: "\u8a2d\u5b9a", es: "Configuraci\u00f3n", ar: "\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a" },
  { key: "nav.security", en: "Security", hi: "\u0938\u0941\u0930\u0915\u094d\u0937\u093e", ta: "\u0baa\u0bbe\u0ba4\u0bc1\u0b95\u0bbe\u0baa\u0bcd\u0baa\u0bc1", zh: "\u5b89\u5168", ja: "\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3", es: "Seguridad", ar: "\u0627\u0644\u0623\u0645\u0627\u0646" },
  { key: "nav.workflows", en: "Workflows", hi: "\u0935\u0930\u094d\u0915\u092b\u093c\u094d\u0932\u094b", ta: "\u0baa\u0ba3\u0bbf\u0baa\u0bcd\u0baa\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1\u0b95\u0bb3\u0bcd", zh: "\u5de5\u4f5c\u6d41", ja: "\u30ef\u30fc\u30af\u30d5\u30ed\u30fc", es: "Flujos de trabajo", ar: "\u0633\u064a\u0631 \u0627\u0644\u0639\u0645\u0644" },
  { key: "chat.placeholder", en: "Type a message...", hi: "\u090f\u0915 \u0938\u0902\u0926\u0947\u0936 \u091f\u093e\u0907\u092a \u0915\u0930\u0947\u0902...", ta: "\u0b92\u0bb0\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0ba4\u0bbf\u0baf\u0bc8 \u0b9f\u0bc8\u0baa\u0bcd \u0b9a\u0bc6\u0baf\u0bcd\u0b95...", zh: "\u8f93\u5165\u6d88\u606f...", ja: "\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u5165\u529b...", es: "Escribe un mensaje...", ar: "...\u0627\u0643\u062a\u0628 \u0631\u0633\u0627\u0644\u0629" },
  { key: "chat.send", en: "Send", hi: "\u092d\u0947\u091c\u0947\u0902", ta: "\u0b85\u0ba9\u0bc1\u0baa\u0bcd\u0baa\u0bc1", zh: "\u53d1\u9001", ja: "\u9001\u4fe1", es: "Enviar", ar: "\u0625\u0631\u0633\u0627\u0644" },
  { key: "status.online", en: "Online", hi: "\u0911\u0928\u0932\u093e\u0907\u0928", ta: "\u0b86\u0ba9\u0bcd\u0bb2\u0bc8\u0ba9\u0bcd", zh: "\u5728\u7ebf", ja: "\u30aa\u30f3\u30e9\u30a4\u30f3", es: "En l\u00ednea", ar: "\u0645\u062a\u0635\u0644" },
  { key: "status.offline", en: "Offline", hi: "\u0911\u092b\u093c\u0932\u093e\u0907\u0928", ta: "\u0b86\u0b83\u0baa\u0bcd\u0bb2\u0bc8\u0ba9\u0bcd", zh: "\u79bb\u7ebf", ja: "\u30aa\u30d5\u30e9\u30a4\u30f3", es: "Desconectado", ar: "\u063a\u064a\u0631 \u0645\u062a\u0635\u0644" },
  { key: "actions.save", en: "Save Changes", hi: "\u092a\u0930\u093f\u0935\u0930\u094d\u0924\u0928 \u0938\u0939\u0947\u091c\u0947\u0902", ta: "\u0bae\u0bbe\u0bb1\u0bcd\u0bb1\u0b99\u0bcd\u0b95\u0bb3\u0bc8 \u0b9a\u0bc7\u0bae\u0bbf", zh: "\u4fdd\u5b58\u66f4\u6539", ja: "\u5909\u66f4\u3092\u4fdd\u5b58", es: "Guardar cambios", ar: "\u062d\u0641\u0638 \u0627\u0644\u062a\u063a\u064a\u064a\u0631\u0627\u062a" },
  { key: "actions.delete", en: "Delete", hi: "\u0939\u091f\u093e\u090f\u0902", ta: "\u0ba8\u0bc0\u0b95\u0bcd\u0b95\u0bc1", zh: "\u5220\u9664", ja: "\u524a\u9664", es: "Eliminar", ar: "\u062d\u0630\u0641" },
  { key: "actions.cancel", en: "Cancel", hi: "\u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902", ta: "\u0bb0\u0ba4\u0bcd\u0ba4\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd", zh: "\u53d6\u6d88", ja: "\u30ad\u30e3\u30f3\u30bb\u30eb", es: "Cancelar", ar: "\u0625\u0644\u063a\u0627\u0621" },
  { key: "errors.notFound", en: "Resource not found", hi: "\u0938\u0902\u0938\u093e\u0927\u0928 \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e", ta: "\u0bb5\u0bb3\u0bae\u0bcd \u0b95\u0ba3\u0bcd\u0b9f\u0bb1\u0bbf\u0baf\u0bb5\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8", zh: "\u8d44\u6e90\u672a\u627e\u5230", ja: "\u30ea\u30bd\u30fc\u30b9\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093", es: "Recurso no encontrado", ar: "\u0627\u0644\u0645\u0648\u0631\u062f \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f" },
  { key: "errors.unauthorized", en: "Unauthorized access", hi: "\u0905\u0928\u0927\u093f\u0915\u0943\u0924 \u092a\u0939\u0941\u0901\u091a", ta: "\u0b85\u0ba9\u0bc1\u0bae\u0ba4\u0bbf\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bbe\u0ba4 \u0b85\u0ba3\u0bc1\u0b95\u0bb2\u0bcd", zh: "\u672a\u6388\u6743\u8bbf\u95ee", ja: "\u4e0d\u6b63\u30a2\u30af\u30bb\u30b9", es: "Acceso no autorizado", ar: "\u0648\u0635\u0648\u0644 \u063a\u064a\u0631 \u0645\u0635\u0631\u062d \u0628\u0647" },
  { key: "budget.totalSpend", en: "Total Spend", hi: "\u0915\u0941\u0932 \u0916\u0930\u094d\u091a", ta: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0b9a\u0bc6\u0bb2\u0bb5\u0bc1", zh: "\u603b\u652f\u51fa", ja: "\u7dcf\u652f\u51fa", es: "Gasto total", ar: "\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0625\u0646\u0641\u0627\u0642" },
];

const DATE_FORMAT_SAMPLES: Record<string, { date: string; number: string; currency: string }> = {
  en: { date: "March 13, 2026", number: "1,234,567.89", currency: "$1,234.56" },
  hi: { date: "13 \u092e\u093e\u0930\u094d\u091a 2026", number: "12,34,567.89", currency: "\u20b91,234.56" },
  ta: { date: "13 \u0bae\u0bbe\u0bb0\u0bcd\u0b9a\u0bcd 2026", number: "12,34,567.89", currency: "\u20b91,234.56" },
  zh: { date: "2026\u5e743\u670813\u65e5", number: "1,234,567.89", currency: "\u00a51,234.56" },
  ja: { date: "2026\u5e743\u670813\u65e5", number: "1,234,567.89", currency: "\u00a51,234.56" },
  es: { date: "13 de marzo de 2026", number: "1.234.567,89", currency: "1.234,56 \u20ac" },
  ar: { date: "\u0661\u0663 \u0645\u0627\u0631\u0633 \u0662\u0660\u0662\u0666", number: "\u0661\u066c\u0662\u0663\u0664\u066c\u0665\u0666\u0667\u066b\u0668\u0669", currency: "\u0661\u066c\u0662\u0663\u0664\u066b\u0665\u0666 \u0631.\u0633" },
};

function getCoverageColor(pct: number): string {
  if (pct >= 95) return "bg-emerald-500";
  if (pct >= 85) return "bg-yellow-500";
  return "bg-orange-500";
}

function getCoverageTextColor(pct: number): string {
  if (pct >= 95) return "text-emerald-400";
  if (pct >= 85) return "text-yellow-400";
  return "text-orange-400";
}

export default function I18nPage() {
  const [selectedLocale, setSelectedLocale] = useState("en");
  const [keySearch, setKeySearch] = useState("");

  const { data: i18nData } = useQuery({
    queryKey: ["i18n"],
    queryFn: () => Promise.resolve(null),
  });

  const locales = (i18nData as LocaleInfo[] | null) ?? MOCK_LOCALES;
  const translations = MOCK_TRANSLATIONS;
  const currentLocale = locales.find((l) => l.code === selectedLocale) ?? locales[0];
  const formats = DATE_FORMAT_SAMPLES[selectedLocale] ?? DATE_FORMAT_SAMPLES.en;

  const avgCoverage = Math.round(locales.reduce((sum, l) => sum + l.coverage, 0) / locales.length);
  const fullyCovered = locales.filter((l) => l.coverage === 100).length;
  const needsWork = locales.filter((l) => l.coverage < 90).length;

  const filteredTranslations = useMemo(
    () =>
      translations.filter(
        (t) =>
          !keySearch ||
          t.key.toLowerCase().includes(keySearch.toLowerCase()) ||
          t.en.toLowerCase().includes(keySearch.toLowerCase()) ||
          (t[selectedLocale] ?? "").toLowerCase().includes(keySearch.toLowerCase()),
      ),
    [keySearch, selectedLocale, translations],
  );

  const statCards = [
    { label: "Locales", value: locales.length, icon: Globe, color: "text-astra-400", bg: "bg-astra-500/10", trend: `${fullyCovered} at 100%` },
    { label: "Avg Coverage", value: `${avgCoverage}%`, icon: Languages, color: "text-blue-400", bg: "bg-blue-500/10", trend: "Across all locales" },
    { label: "Total Keys", value: locales[0]?.totalKeys ?? 342, icon: Hash, color: "text-emerald-400", bg: "bg-emerald-500/10", trend: "Translation strings" },
    { label: "Needs Work", value: needsWork, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", trend: needsWork === 0 ? "All good" : `Below 90% coverage` },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-astra-500 to-blue-600 rounded-xl flex items-center justify-center">
              <Globe className="w-5 h-5 text-white" />
            </div>
            Internationalization
          </h1>
          <p className="text-gray-500 mt-1 ml-[52px]">Manage locales, translations, and format preferences</p>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Current Locale</label>
          <select
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value)}
            className="input w-48"
          >
            {locales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.nativeName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, trend }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="text-3xl font-bold text-white mt-1">{value}</p>
                <p className="text-xs text-gray-500 mt-1">{trend}</p>
              </div>
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Language Coverage */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Languages className="w-5 h-5 text-astra-400" /> Language Coverage
        </h3>
        <div className="space-y-3">
          {locales.map((locale) => (
            <div
              key={locale.code}
              className={`flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border transition-colors ${
                locale.code === selectedLocale
                  ? "border-astra-500/40 bg-astra-500/5"
                  : "border-white/[0.06] hover:border-white/[0.08]"
              }`}
              onClick={() => setSelectedLocale(locale.code)}
              role="button"
              tabIndex={0}
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                  <span className="text-sm font-bold text-white uppercase">{locale.code}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{locale.name}</p>
                    <span className="text-xs text-gray-500">{locale.nativeName}</span>
                    {locale.direction === "rtl" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">RTL</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden max-w-xs">
                      <div
                        className={`h-full rounded-full ${getCoverageColor(locale.coverage)}`}
                        style={{ width: `${locale.coverage}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium ${getCoverageTextColor(locale.coverage)}`}>
                      {locale.coverage}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right ml-4">
                <p className="text-sm text-white font-medium">{locale.translatedKeys}/{locale.totalKeys}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                  <Clock className="w-3 h-3" />
                  {new Date(locale.lastUpdated).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Translation Key Browser + Date/Number Formats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Translation Key Browser */}
        <div className="lg:col-span-2 card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Hash className="w-5 h-5 text-astra-400" /> Translation Keys
          </h3>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search keys or values..."
              value={keySearch}
              onChange={(e) => setKeySearch(e.target.value)}
              className="input w-full pl-10"
            />
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {filteredTranslations.map((entry) => {
              const hasTranslation = !!entry[selectedLocale];
              return (
                <div
                  key={entry.key}
                  className="flex items-start gap-3 bg-white/[0.04] rounded-lg p-3 border border-white/[0.06] hover:border-white/[0.08] transition-colors"
                >
                  <div className="mt-0.5">
                    {hasTranslation ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{entry.key}</p>
                    <p className="text-sm text-gray-400 mt-0.5">
                      <span className="text-gray-600">en:</span> {entry.en}
                    </p>
                    {selectedLocale !== "en" && (
                      <p className="text-sm text-white mt-0.5">
                        <span className="text-gray-600">{selectedLocale}:</span>{" "}
                        {entry[selectedLocale] || (
                          <span className="text-amber-400 italic">Missing translation</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredTranslations.length === 0 && (
              <div className="text-center py-8">
                <Search className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No matching translation keys</p>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Showing {filteredTranslations.length} of {translations.length} keys
          </p>
        </div>

        {/* Date/Number Format Preview */}
        <div className="space-y-5">
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-astra-400" /> Format Preview
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Previewing formats for <span className="text-astra-400 font-medium">{currentLocale.name}</span>
              {currentLocale.direction === "rtl" && " (RTL)"}
            </p>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Date Format</p>
                <div className="bg-white/[0.04] rounded-lg p-3 border border-white/[0.06]">
                  <p className="text-sm text-white font-medium" dir={currentLocale.direction}>{formats.date}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Number Format</p>
                <div className="bg-white/[0.04] rounded-lg p-3 border border-white/[0.06]">
                  <p className="text-sm text-white font-medium" dir={currentLocale.direction}>{formats.number}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Currency Format</p>
                <div className="bg-white/[0.04] rounded-lg p-3 border border-white/[0.06]">
                  <p className="text-sm text-white font-medium" dir={currentLocale.direction}>{formats.currency}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-astra-400" /> Locale Details
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Code</span>
                <span className="text-white font-mono">{currentLocale.code}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Direction</span>
                <span className="text-white uppercase">{currentLocale.direction}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Coverage</span>
                <span className={getCoverageTextColor(currentLocale.coverage)}>
                  {currentLocale.coverage}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Translated</span>
                <span className="text-white">{currentLocale.translatedKeys}/{currentLocale.totalKeys}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Missing</span>
                <span className={currentLocale.totalKeys - currentLocale.translatedKeys > 0 ? "text-amber-400" : "text-emerald-400"}>
                  {currentLocale.totalKeys - currentLocale.translatedKeys}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Updated</span>
                <span className="text-gray-300 text-xs">{new Date(currentLocale.lastUpdated).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
