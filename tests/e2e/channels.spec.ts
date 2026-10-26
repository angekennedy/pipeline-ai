import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

test("preset de chaîne : création, brief prérempli, copie gardée par le pipeline après suppression", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Presets de chaîne" }).click();
  await expect(page.getByRole("heading", { name: "Aucun preset pour l'instant" })).toBeVisible();
  await expect(page.getByText("0 sur 1 avec le plan Free", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Créer mon premier preset" }).click();
  await page.getByLabel("Nom du preset").fill("Mystères d'Égypte");
  await page.getByLabel("Niche").fill("Histoire ancienne");
  await page.getByLabel("Langue", { exact: true }).selectOption("en");
  await page.getByLabel("Ton").selectOption("mysterious");
  await page.getByLabel("Public visé (facultatif)").fill("Passionnés d'histoire");
  await page.getByLabel("Mots interdits").fill("aliens, secret");
  await page.getByLabel("Palette des miniatures").fill("rouge");
  await page.getByRole("button", { name: "Créer le preset" }).click();
  await expect(page.getByText("6 couleurs au plus, au format #RRGGBB")).toBeVisible();
  await expect(page.getByLabel("Nom du preset")).toHaveValue("Mystères d'Égypte"); // saisie gardée
  await page.getByLabel("Palette des miniatures").fill("#FFD400, #000000");
  await page.getByRole("button", { name: "Créer le preset" }).click();

  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/channels$/);
  await expect(page.getByRole("link", { name: "Mystères d'Égypte" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Le plan Free est limité à 1 preset" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouveau preset" })).toHaveCount(0);
  const channelUrl = await page.getByRole("link", { name: "Mystères d'Égypte" }).getAttribute("href");

  // Le preset préremplit le brief ; ce qu'il ne fixe pas (le style) garde la saisie.
  await page.goto("/pipelines/new");
  await page.getByLabel("Style").selectOption("listicle");
  await page.getByLabel("Preset de chaîne").selectOption("Mystères d'Égypte");
  await expect(page.getByLabel("Niche")).toHaveValue("Histoire ancienne");
  await expect(page.getByLabel("Langue", { exact: true })).toHaveValue("en");
  await expect(page.getByLabel("Ton")).toHaveValue("mysterious");
  await expect(page.getByLabel("Style")).toHaveValue("listicle");
  await expect(page.getByLabel("Public visé (facultatif)")).toHaveValue("Passionnés d'histoire");
  await page.getByLabel("Sujet de la vidéo").fill("How were the pyramids of Giza built?");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How were the pyramids of Giza built?" })).toBeVisible();
  await expect(page.getByText("Preset Mystères d'Égypte", { exact: false })).toBeVisible();
  const pipelineUrl = page.url();

  // Un autre utilisateur reçoit un vrai 404 sur ce preset.
  const other = await browser.newPage();
  await signIn(other);
  expect((await other.goto(channelUrl!))?.status()).toBe(404);
  await other.close();

  // Modifié puis supprimé : le pipeline garde le preset de son lancement.
  await page.goto(channelUrl!);
  await expect(page.getByLabel("Mots interdits")).toHaveValue("aliens, secret");
  await page.getByLabel("Nom du preset").fill("Mystères (v2)");
  await page.getByRole("button", { name: "Enregistrer le preset" }).click();
  await expect(page.getByRole("link", { name: "Mystères (v2)" })).toBeVisible();
  await page.getByRole("link", { name: "Mystères (v2)" }).click();
  await page.getByRole("button", { name: "Supprimer le preset" }).click();
  await expect(page.getByRole("heading", { name: "Aucun preset pour l'instant" })).toBeVisible();

  await page.goto(pipelineUrl);
  await expect(page.getByText("Preset Mystères d'Égypte", { exact: false })).toBeVisible();
});
