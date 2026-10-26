import { expect, test } from "@playwright/test";
import { signIn, testEmail } from "./auth";

test("paramètres : profil, workspace renommé, puis suppression du compte et nouveau départ", async ({ page }) => {
  const email = testEmail();
  await signIn(page, { email });
  await page.goto("/");
  await page.getByRole("link", { name: email }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();

  await page.getByLabel("Nom affiché").fill("Ada");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Profil enregistré.")).toBeVisible();

  await page.getByLabel("Nom du workspace").fill("Studio Ada");
  await page.getByRole("button", { name: "Renommer" }).click();
  await expect(page.getByText("Workspace renommé.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("Studio Ada", { exact: true })).toBeVisible();

  // Une création pour vérifier que le compte supprimé ne laisse rien derrière lui.
  await page.goto("/pipelines/new");
  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill("Comment les pyramides de Gizeh ont-elles été construites ?");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/);
  const pipelineUrl = new URL(page.url()).pathname;

  await page.goto("/settings");
  await expect(page.getByText("le workspace « Studio Ada » et tout son contenu", { exact: false })).toBeVisible();
  const button = page.getByRole("button", { name: "Supprimer définitivement mon compte" });
  await expect(button).toBeDisabled();
  await page.getByLabel(/saisissez votre adresse e-mail/).fill(email);
  await button.click();

  await expect(page).toHaveURL(/\/compte-supprime$/);
  await expect(page.getByRole("heading", { name: "Compte supprimé" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible(); // session effacée
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);

  // Même adresse : un compte neuf, sans rien de l'ancien.
  await signIn(page, { email });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Aucun pipeline pour l'instant" })).toBeVisible();
  await expect(page.getByRole("link", { name: /30 crédits disponibles/ })).toBeVisible();
  expect((await page.goto(pipelineUrl))?.status()).toBe(404);
});
