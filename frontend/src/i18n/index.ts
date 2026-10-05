import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./en.json";
import fr from "./fr.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

// Optional build-time default (VITE_DEFAULT_LANGUAGE). When set, a first visit
// uses it instead of the browser language; a language picked in the switcher
// is still remembered.
const configuredDefault = SUPPORTED_LANGUAGES.find(
  (l) => l.code === import.meta.env.VITE_DEFAULT_LANGUAGE,
)?.code;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: configuredDefault ? [configuredDefault, "en"] : "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: configuredDefault ? ["localStorage"] : ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "ts_lang",
    },
  });

export default i18n;
