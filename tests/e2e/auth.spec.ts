import { expect, test } from "@playwright/test";
import { magicLinkPath, signIn, testEmail } from "./auth";

test("une route de l'application renvoie vers /login, puis y ramène après le lien magique", async ({ page }) => {
  await page.goto("/pipelines/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fpipelines%2Fnew$/);
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();

  const email = testEmail();
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien de connexion" }).click();
  await expect(page.getByRole("status")).toContainText(`Un lien de connexion a été envoyé à ${email}`);

  // Le lien de l'e-mail : même jeton que celui que Supabase vient d'envoyer, généré par l'API admin.
  await page.goto(await magicLinkPath(email));
  await expect(page).toHaveURL(/\/pipelines\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau pipeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});

test("un lien déjà utilisé est refusé avec un message clair", async ({ page }) => {
  const email = await signIn(page);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible();

  const link = await magicLinkPath(email);
  await page.goto(link);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible(); // session bien fermée
  await page.goto(link); // rejoué
  await expect(page).toHaveURL(/\/login\?error=lien$/);
  await expect(page.getByRole("alert").filter({ hasText: "Ce lien de connexion a expiré ou a déjà servi." })).toBeVisible();
});

test("une session ouverte saute la page de connexion, et la déconnexion referme l'application", async ({ page }) => {
  await signIn(page);
  await page.goto("/login?next=/pipelines/new");
  await expect(page).toHaveURL(/\/pipelines\/new$/);

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/pipelines/new");
  await expect(page).toHaveURL(/\/login/);
});
