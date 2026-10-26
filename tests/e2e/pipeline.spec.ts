import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { sentEvents } from "./inngest";

// Création réelle (réservation en base, événement envoyé au bouchon Inngest) ; la génération en direct
// est montrée par le pipeline de démonstration, rejoué dans le navigateur.

test("brief → pipeline créé dans le workspace, en file d'attente, et sa génération lancée", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Créer un pipeline" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/pipelines\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau pipeline" })).toBeVisible();

  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/pipelines\/[0-9a-f-]{36}$/);
  const pipelineId = page.url().split("/").at(-1)!;
  await expect(page.getByRole("heading", { level: 1, name: "Comment les pyramides de Gizeh ont-elles été construites ?" })).toBeVisible();
  await expect(page.getByText("En file d'attente", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /12 crédits disponibles/ })).toBeVisible(); // 18 réservés sur 30

  const events = await sentEvents();
  expect(events.filter((e) => e.data.pipelineId === pipelineId)).toEqual([
    expect.objectContaining({ name: "pipeline/requested", id: `pipeline-requested:${pipelineId}` }),
  ]);
});

test("un autre utilisateur reçoit un 404 sur ce pipeline et sur ce workspace", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/pipelines/new");
  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/);
  const pipelineUrl = new URL(page.url()).pathname;
  const workspaceUrl = pipelineUrl.split("/pipelines/")[0]!;

  const other = await browser.newPage();
  await signIn(other);
  for (const path of [pipelineUrl, `${workspaceUrl}/pipelines/new`]) {
    const response = await other.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(other.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  }
  await other.close();
});

test("démonstration : première scène en moins de 10 s, puis pipeline terminé", async ({ page }) => {
  const openedAt = Date.now();
  await page.goto("/pipelines/demo-running");
  await expect(page.getByText("1. Le bloc impossible")).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - openedAt).toBeLessThan(10_000);

  await expect(page.getByText("Terminé", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /Titres/ }).click();
  await expect(page.getByText("Recommandé")).toBeVisible();
});

test("un brief invalide affiche l'erreur du champ, sans quitter le formulaire", async ({ page }) => {
  await signIn(page);
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

  for (const path of ["/", "/dashboard", "/settings", "/pipelines/new", "/pricing", "/pipelines/demo-completed", "/pipelines/demo-partial"]) {
    test(`${path} ne déborde pas horizontalement`, async ({ page }) => {
      await signIn(page); // en-tête d'un utilisateur connecté, le plus chargé
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const [scrollWidth, viewportWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
    });
  }
});
