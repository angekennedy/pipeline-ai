import { expect, test } from "@playwright/test";

// Parcours en mode démo (pas encore de base) : les composants, la Server Action et la
// validation sont ceux de la production, seule la génération est rejouée.

test("brief → génération en direct : première scène en moins de 10 s, puis pipeline terminé", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Créer un pipeline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau pipeline" })).toBeVisible();

  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  const submittedAt = Date.now();
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  await expect(page).toHaveURL(/\/pipelines\/demo-running$/);
  await expect(page.getByText("1. Le bloc impossible")).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - submittedAt).toBeLessThan(10_000);

  await expect(page.getByText("Terminé", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /Titres/ }).click();
  await expect(page.getByText("Recommandé")).toBeVisible();
});

test("un brief invalide affiche l'erreur du champ, sans quitter le formulaire", async ({ page }) => {
  await page.goto("/pipelines/new");
  await page.getByLabel("Niche").fill("H");
  await page.getByLabel("Sujet de la vidéo").fill("Les pyramides de Gizeh");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  await expect(page.getByText("Indiquez la niche de la chaîne, en 2 à 80 caractères.")).toBeVisible();
  await expect(page).toHaveURL(/\/pipelines\/new$/);
  await expect(page.getByLabel("Sujet de la vidéo")).toHaveValue("Les pyramides de Gizeh");
});

test("pipeline partiel : l'asset en échec l'explique, les autres sont prêts à copier", async ({ page }) => {
  await page.goto("/pipelines/demo-partial");
  await expect(page.getByText("Partiel", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copier le script/ })).toBeVisible();
  await page.getByRole("tab", { name: /SEO/ }).click();
  await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText("Échec de la génération");
});

test("script modifié : les dérivés sont signalés obsolètes, avec le coût de leur régénération", async ({ page }) => {
  await page.goto("/pipelines/demo-stale");
  await expect(page.getByText("Le script a changé : 4 assets sont obsolètes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Régénérer les dérivés (6 crédits)" })).toBeDisabled();
  await page.getByText("Historique · 2 versions").click();
  await expect(page.getByText("Édition manuelle")).toBeVisible();
  await page.getByRole("tab", { name: /Titres/ }).click();
  await expect(page.getByRole("tabpanel").getByText(/Obsolète :/)).toBeVisible();
});

// La page est streamée (loading.tsx) : la réponse part en 200 avant que notFound() soit atteint.
// Next ajoute alors une balise noindex (documenté dans file-conventions/loading, « Status codes »).
test("un pipeline inconnu affiche une page introuvable, exclue de l'indexation", async ({ page }) => {
  await page.goto("/pipelines/inconnu");
  await expect(page.getByRole("heading", { name: "Pipeline introuvable" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test.describe("sur mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ["/", "/pipelines/new", "/pipelines/demo-completed", "/pipelines/demo-partial"]) {
    test(`${path} ne déborde pas horizontalement`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const [scrollWidth, viewportWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
    });
  }
});
