import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { sentEvents } from "./inngest";
import { seedCompletedPipeline } from "./pipelines";

const EDITED = "Narration réécrite à la main : la rampe en spirale est enfin expliquée, pierre par pierre.";

test("éditer le script, puis régénérer les dérivés à partir de la nouvelle version", async ({ page }) => {
  const email = await signIn(page);
  const { path, pipelineId } = await seedCompletedPipeline(email);
  await page.goto(path);
  await expect(page.getByRole("link", { name: /30 crédits disponibles/ })).toBeVisible();

  await page.getByRole("button", { name: "Modifier le script" }).click();
  const scene = page.getByRole("group", { name: /Scène 2/ });
  await scene.getByLabel("Narration").fill(EDITED);
  await page.getByRole("button", { name: "Enregistrer une nouvelle version" }).click();

  await expect(page.getByText(EDITED)).toBeVisible();
  await expect(page.getByText("Historique · 2 versions")).toBeVisible();
  await expect(page.getByText("Le script a changé : 4 assets sont obsolètes.")).toBeVisible();

  // 6 crédits : titres 1, SEO 2, voix off 2, miniatures 1, réservés d'un coup.
  await page.getByRole("button", { name: "Régénérer les dérivés (6 crédits)" }).click();
  await expect(page.getByText("Régénération lancée : la page se met à jour.")).toBeVisible();
  await expect(page.getByRole("link", { name: /24 crédits disponibles/ })).toBeVisible();

  const events = (await sentEvents()).filter((event) => event.name === "asset/regenerate.requested" && event.data.pipelineId === pipelineId);
  expect(events).toHaveLength(1); // une exécution, dans l'ordre du DAG
  expect(events[0]!.data).toMatchObject({
    assetType: "titles",
    then: [
      { assetType: "seo", regenerationKey: expect.stringMatching(/^regen:.+-seo$/) },
      { assetType: "voiceover", regenerationKey: expect.stringMatching(/^regen:.+-voiceover$/) },
      { assetType: "thumbnails", regenerationKey: expect.stringMatching(/^regen:.+-thumbnails$/) },
    ],
  });
});

test("restaurer la version d'origine du script, et télécharger les exports", async ({ page }) => {
  const email = await signIn(page);
  const { path, pipelineId } = await seedCompletedPipeline(email);
  await page.goto(path);
  await page.getByRole("button", { name: "Modifier le script" }).click();
  await page.getByRole("group", { name: /Scène 2/ }).getByLabel("Narration").fill(EDITED);
  await page.getByRole("button", { name: "Enregistrer une nouvelle version" }).click();
  await expect(page.getByText("Le script a changé : 4 assets sont obsolètes.")).toBeVisible();

  await page.getByText("Historique · 2 versions").click();
  await page.getByRole("button", { name: "Restaurer" }).click();
  await expect(page.getByText("Historique · 3 versions")).toBeVisible();
  await expect(page.getByText(EDITED)).toHaveCount(0);
  await expect(page.getByText(/assets? (sont|est) obsolètes?/)).toHaveCount(0); // les dérivés correspondent à nouveau

  // Exports (tâche 4.1) : liens de la page, servis par la route sous RLS.
  const zip = page.getByRole("link", { name: "Tout (ZIP)" });
  await expect(zip).toHaveAttribute("href", `/api/pipelines/${pipelineId}/export?format=zip`);
  const download = await page.request.get(`/api/pipelines/${pipelineId}/export?format=txt`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toMatch(/^attachment; filename="pipeline-.+\.voix-off\.txt"$/);
  expect(await download.text()).not.toMatch(/\[pause|<|>/);
});
