import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

type Language = "en";

const DEFAULT_LANGUAGE: Language = "en";

const getInitialLanguage = (): Language => {
  return DEFAULT_LANGUAGE;
};

const resources = {
  en: {
    translation: en,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "en",

  interpolation: {
    escapeValue: false,
  },

  debug: false,
});

export default i18n;
