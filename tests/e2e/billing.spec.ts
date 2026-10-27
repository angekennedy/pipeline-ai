import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Compte Free tout juste inscrit (30 crédits), dont 10 sont réservés par un pipeline en cours.

test("le coût s'affiche avant le lancement, et un pipeline trop cher ouvre le modal sans rien lancer", async ({ page }) => {
  await signIn(page, { reserved: 10 });
  await page.goto("/pipelines/new");
  await expect(page.getByRole("link", { name: /20 crédits disponibles, plan Free/ })).toBeVisible();
  const estimate = page.getByRole("region", { name: /Coût/ });
  await expect(estimate).toContainText("Coût : 18 crédits");

  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  await page.getByLabel("Durée cible (minutes)").fill("10");
  await expect(estimate).toContainText("Il vous manque 1 crédit");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  const dialog = page.getByRole("dialog", { name: "Crédits insuffisants" });
  await expect(dialog).toContainText("Ce pipeline coûte 21 crédits et vous en avez 20 disponibles");
  await expect(page).toHaveURL(/\/pipelines\/new$/);

  await dialog.getByRole("button", { name: "Modifier le brief" }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel("Durée cible (minutes)").fill("8");
  await expect(estimate).toContainText("Coût : 18 crédits");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: /2 crédits disponibles/ })).toBeVisible(); // 18 de plus réservés
});

test("le plan Free refuse une vidéo de plus de 10 min avec un message explicite", async ({ page }) => {
  await signIn(page);
  await page.goto("/pipelines/new");
  await expect(page.getByLabel(/Premium/)).toBeDisabled();
  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  await page.getByLabel("Durée cible (minutes)").fill("15");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Le plan Free limite les vidéos à 10 min" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("link", { name: "Voir les tarifs" })).toHaveAttribute("href", "/pricing");
  await expect(page).toHaveURL(/\/pipelines\/new$/);
  await expect(page.getByLabel("Durée cible (minutes)")).toHaveValue("15");
});

test("la page des tarifs présente les plans, les packs et la grille de crédits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Tarifs", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tarifs" })).toBeVisible();
  for (const plan of ["Free", "Creator", "Pro", "Studio"]) {
    await expect(page.getByRole("heading", { level: 2, name: plan, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Packs de crédits" })).toBeVisible();
  await expect(page.getByText(/Vidéo de 10 min, Standard/)).toContainText("35 crédits"); // plan payant, miniatures en images HD
});

// Sans STRIPE_SECRET_KEY (CI) : la page reste utile, sans bouton de paiement. Le paiement réel en mode
// test est vérifié à la main avec la Stripe CLI (docs/DEPLOYMENT.md).
test("la facturation affiche le plan, le solde et l'historique des crédits", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("link", { name: /30 crédits disponibles, plan Free/ }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/billing$/);
  await expect(page.getByRole("heading", { level: 2, name: "Plan Free" })).toBeVisible();
  await expect(page.getByText("30 crédits disponibles")).toBeVisible();
  await expect(page.getByText("Le paiement en ligne n'est pas configuré sur cet environnement.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Choisir le plan/ })).toHaveCount(0);

  const history = page.getByRole("table");
  await expect(history.getByRole("row")).toHaveCount(2); // en-tête et crédits d'inscription
  await expect(history.getByRole("row").nth(1)).toContainText("Crédits du plan");
  await expect(history.getByRole("row").nth(1)).toContainText("+30");

  await page.goto(`${new URL(page.url()).pathname}?success=1`);
  await expect(page.getByRole("status").filter({ hasText: "Paiement reçu, merci." })).toBeVisible();
});
