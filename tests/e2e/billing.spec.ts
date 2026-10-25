import { expect, test } from "@playwright/test";

// Mode démo : solde Free de 30 crédits (lib/demo/credits.ts).

test("le coût s'affiche avant le lancement, et un pipeline trop cher ouvre le modal sans rien lancer", async ({ page }) => {
  await page.goto("/pipelines/new");
  await expect(page.getByRole("link", { name: /30 crédits disponibles, plan Free/ })).toBeVisible();
  const estimate = page.getByRole("region", { name: /Coût/ });
  await expect(estimate).toContainText("Coût : 18 crédits");

  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  await page.getByLabel("Durée cible (minutes)").fill("10");
  await page.getByLabel(/Premium/).check();
  await expect(estimate).toContainText("Il vous manque 5 crédits");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  const dialog = page.getByRole("dialog", { name: "Crédits insuffisants" });
  await expect(dialog).toContainText("Ce pipeline coûte 35 crédits et vous en avez 30 disponibles");
  await expect(page).toHaveURL(/\/pipelines\/new$/);

  await dialog.getByRole("button", { name: "Modifier le brief" }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel(/Standard/).check();
  await expect(estimate).toContainText("Coût : 21 crédits");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page).toHaveURL(/\/pipelines\/demo-running$/);
});

test("la page des tarifs présente les plans, les packs et la grille de crédits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Tarifs", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tarifs" })).toBeVisible();
  for (const plan of ["Free", "Creator", "Pro", "Studio"]) {
    await expect(page.getByRole("heading", { level: 2, name: plan, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Packs de crédits" })).toBeVisible();
  await expect(page.getByText(/Vidéo de 10 min, Standard/)).toContainText("21 crédits");
});
