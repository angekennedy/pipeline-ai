import { expect, test } from "@playwright/test";

// Langue de l'interface : celle du navigateur par défaut, puis celle du sélecteur, gardée en cookie.

test("passe l'interface en anglais depuis l'en-tête, et s'en souvient", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Créer un pipeline" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");

  await page.getByRole("group", { name: "Langue de l'interface" }).getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("link", { name: "Create a pipeline" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
  await expect(page).toHaveTitle("Pricing · Pipeline AI");

  await page.getByRole("button", { name: "FR" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tarifs" })).toBeVisible();
});

test.describe("navigateur en anglais", () => {
  test.use({ locale: "en-US" });

  test("affiche l'anglais sans rien choisir", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Create a pipeline" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
