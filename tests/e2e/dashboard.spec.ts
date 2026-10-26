import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

const TOPIC = "Comment les pyramides de Gizeh ont-elles été construites ?";

test("tableau de bord : état vide, pipeline listé, recherche, puis duplication du brief", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Mes pipelines" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Aucun pipeline pour l'instant" })).toBeVisible();

  await page.getByRole("link", { name: "Créer mon premier pipeline" }).click();
  await page.getByLabel("Niche").fill("Histoire");
  await page.getByLabel("Sujet de la vidéo").fill(TOPIC);
  await page.getByLabel("Ton").selectOption("mysterious");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/);

  await page.getByRole("link", { name: "Tous les pipelines" }).click();
  const list = page.getByRole("list").filter({ has: page.getByRole("link", { name: TOPIC, exact: true }) });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("En file d'attente")).toBeVisible();
  await expect(page.getByText("1 pipeline", { exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Rechercher un pipeline par sujet" });
  await search.fill("PYRAMIDES");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/\?q=PYRAMIDES$/);
  await expect(page.getByText("1 pipeline pour « PYRAMIDES »")).toBeVisible();
  await expect(page.getByRole("link", { name: TOPIC, exact: true })).toBeVisible();

  await search.fill("volcans");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText("Aucun pipeline ne correspond à cette recherche.")).toBeVisible();
  await page.getByRole("link", { name: "Effacer la recherche" }).click();

  await page.getByRole("link", { name: `Dupliquer le brief « ${TOPIC} »` }).click();
  await expect(page).toHaveURL(/\/pipelines\/new\?from=[0-9a-f-]{36}$/);
  await expect(page.getByRole("status").filter({ hasText: `Brief repris de « ${TOPIC} »` })).toBeVisible();
  await expect(page.getByLabel("Niche")).toHaveValue("Histoire");
  await expect(page.getByLabel("Sujet de la vidéo")).toHaveValue(TOPIC);
  await expect(page.getByLabel("Ton")).toHaveValue("mysterious");

  // 12 crédits restent après la première réservation (18) : une version d'une minute (11) passe.
  await page.getByLabel("Sujet de la vidéo").fill("Les pyramides en une minute");
  await page.getByLabel("Durée cible (minutes)").fill("1");
  await page.getByRole("button", { name: "Générer le pipeline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Les pyramides en une minute" })).toBeVisible();

  await page.getByRole("link", { name: "Tous les pipelines" }).click();
  await expect(page.getByText("2 pipelines", { exact: true })).toBeVisible();
  const titles = page.getByRole("listitem").getByRole("link").filter({ hasNotText: "Dupliquer" });
  await expect(titles).toHaveText(["Les pyramides en une minute", TOPIC]); // le plus récent d'abord

  // Page au-delà de la dernière (lien ancien) : renvoyé vers la dernière page existante.
  const dashboard = new URL(page.url()).pathname;
  await page.goto(`${dashboard}?q=pyramides&page=4`);
  await expect(page).toHaveURL(new RegExp(`${dashboard}\\?q=pyramides$`));
  await expect(titles).toHaveCount(2);
});

test("une recherche ou une page hors limites ne casse pas le tableau de bord", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/dashboard$/);
  const dashboard = new URL(page.url()).pathname;
  await page.goto(`${dashboard}?page=7&q=${encodeURIComponent("100%_\\")}`);
  await expect(page.getByText("Aucun pipeline ne correspond à cette recherche.")).toBeVisible();
});
