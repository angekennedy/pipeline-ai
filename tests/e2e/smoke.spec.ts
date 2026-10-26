import { expect, test } from "@playwright/test";

test("la page d'accueil se charge et mène à l'exemple réel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tout ce qu'il faut pour une vidéo YouTube faceless, en quelques minutes");
  await page.getByRole("link", { name: "Voir un exemple réel" }).click();
  await expect(page).toHaveURL(/\/pipelines\/demo-rome$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pourquoi l'Empire romain d'Occident s'est-il effondré en 476 ?" })).toBeVisible();
  await expect(page.getByText(/^Exemple réel, sans retouche : script rédigé par Claude Sonnet 5\.5, dérivés par Claude Haiku 5\.5\./)).toBeVisible();
});

test("le pied de page mène aux documents légaux", async ({ page }) => {
  await page.goto("/");
  const legal = page.getByRole("navigation", { name: "Informations légales" });
  await legal.getByRole("link", { name: "CGU" }).click();
  await expect(page).toHaveURL(/\/cgu$/);
  await expect(page.getByRole("heading", { level: 1, name: "Conditions générales d'utilisation et de vente" })).toBeVisible();
  for (const [name, heading] of [["Confidentialité", "Politique de confidentialité"], ["Charte d'usage", "Charte d'usage de l'IA et de YouTube"], ["Mentions légales", "Mentions légales"]]) {
    await legal.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("sitemap, robots et image de partage sont servis", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("/pipelines/demo-rome</loc>");
  expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/admin[\s\S]*Sitemap: http/);
  const image = await request.get("/opengraph-image");
  expect(image.headers()["content-type"]).toBe("image/png");
});
