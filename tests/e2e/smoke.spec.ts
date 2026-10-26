import { expect, test } from "@playwright/test";

test("la page d'accueil se charge et mène à l'exemple réel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tout ce qu'il faut pour une vidéo YouTube faceless, en quelques minutes");
  await page.getByRole("link", { name: "Voir un exemple réel" }).click();
  await expect(page).toHaveURL(/\/pipelines\/demo-rome$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pourquoi l'Empire romain d'Occident s'est-il effondré en 476 ?" })).toBeVisible();
  await expect(page.getByText(/^Exemple réel, sans retouche : script rédigé par Claude Sonnet 5\.5, dérivés par Claude Haiku 5\.5\./)).toBeVisible();
});

test("sitemap, robots et image de partage sont servis", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("/pipelines/demo-rome</loc>");
  expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/admin[\s\S]*Sitemap: http/);
  const image = await request.get("/opengraph-image");
  expect(image.headers()["content-type"]).toBe("image/png");
});
