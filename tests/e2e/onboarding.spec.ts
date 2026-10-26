import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Onboarding (tâche 5.4) : du tableau de bord vide au pipeline lancé, sans rien saisir. La génération
// elle-même ne tourne pas ici (Inngest bouchonné) : un brief de 3 min se génère en moins d'une
// minute (evals/report), ce qui tient l'objectif de moins de 2 min pour le premier pipeline.
test("un nouveau compte lance son premier pipeline à partir d'un exemple, en deux clics", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Aucun pipeline pour l'instant" })).toBeVisible();

  const started = Date.now();
  await page.getByRole("link", { name: "Essayer avec un brief d'exemple" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Brief d'exemple chargé" })).toBeVisible();
  await expect(page.getByLabel("Sujet de la vidéo")).toHaveValue("Pourquoi les Vikings ont-ils abandonné le Groenland ?");
  await expect(page.getByLabel("Durée cible (minutes)")).toHaveValue("3");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pourquoi les Vikings ont-ils abandonné le Groenland ?" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(15_000); // le parcours lui-même, hors génération
});

test("le formulaire vierge propose les exemples, qui le remplissent en un clic", async ({ page }) => {
  await signIn(page);
  await page.goto("/pipelines/new");
  await page.getByRole("region", { name: "Pas d'idée ? Partez d'un exemple" }).getByRole("button", { name: "Le bleu du ciel" }).click();
  await expect(page.getByLabel("Niche")).toHaveValue("Sciences");
  await expect(page.getByLabel("Style")).toHaveValue("explainer");
});
