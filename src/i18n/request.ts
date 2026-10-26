import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, pickLocale } from "./locales";

// Configuration next-intl de chaque rendu serveur : langue de l'utilisateur et ses messages.
export default getRequestConfig(async () => {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = pickLocale(store.get(LOCALE_COOKIE)?.value, requestHeaders.get("accept-language"));
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
