import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/site";

// Pages publiques (tâche 5.1). Une seule URL par page : la langue suit le navigateur ou le
// sélecteur, sans préfixe d'URL (tâche 4.4).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.map((path) => ({
    url: new URL(path, base).toString(),
    changeFrequency: path === "/" || path === "/pricing" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/pricing" ? 0.8 : 0.6,
  }));
}
