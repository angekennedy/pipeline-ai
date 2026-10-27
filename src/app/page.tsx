import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { pipelineCredits } from "@/lib/billing/costs";
import { PLANS } from "@/lib/billing/plans";
import { example, exampleFor } from "@/lib/demo/examples";

export async function generateMetadata(): Promise<Metadata> {
  const [meta, home] = await Promise.all([getTranslations("Meta"), getTranslations("Home")]);
  return { title: { absolute: meta("home") }, description: home("tagline"), alternates: { canonical: "/" } };
}

// Démonstrations des états d'un pipeline (src/lib/demo/pipelines.ts) ; libellés : Home.demos.
const DEMOS = ["running", "completed", "partial", "failed", "stale"] as const;
const STEPS = ["brief", "live", "export"] as const;
const FAQ = ["faceless", "video", "models", "failures", "accuracy", "languages"] as const;

// Landing (tâche 5.1) : promesse, pipeline d'exemple réel dans la langue de l'interface, livrables,
// fonctionnement, tarifs, FAQ (avec ses données structurées schema.org).
export default async function Home() {
  const [locale, t, labels, format] = await Promise.all([getLocale(), getTranslations("Home"), getTranslations("Labels"), getFormatter()]);
  const exampleId = exampleFor(locale);
  const { view, meta } = example(exampleId)!;
  const { script, titles, seo } = view.assets;
  const recommended = titles.content!.variants[titles.content!.recommendedIndex]!.title;
  // Sur un plan payant, miniatures en images HD comprises.
  const tenMinutes = pipelineCredits({ durationMinutes: 10, thumbnailImages: true }, "standard");

  const faq = FAQ.map((key) => ({ question: t(`faq.${key}.q`), answer: t(`faq.${key}.a`) }));
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-20 px-4 py-16">
      <section className="flex flex-col items-center gap-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">Pipeline AI</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{t("heroTitle")}</h1>
        <p className="max-w-xl text-lg text-muted-foreground">{t("tagline")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/pipelines/new" className={buttonVariants({ size: "lg" })}>
            {t("create")}
          </Link>
          <Link href={`/pipelines/${exampleId}`} className={buttonVariants({ size: "lg", variant: "outline" })}>
            {t("seeExample")}
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">{t("freeCredits", { credits: PLANS.free.credits })}</p>
      </section>

      <section aria-labelledby="example" className="grid gap-4">
        <div>
          <h2 id="example" className="text-2xl font-semibold tracking-tight">
            {t("exampleTitle")}
          </h2>
          <p className="mt-1 text-muted-foreground">{t("exampleText")}</p>
        </div>
        <figure className="grid gap-4 rounded-xl border p-5">
          <p className="text-sm text-muted-foreground">
            {t("exampleBrief", { topic: view.brief.topic, minutes: view.brief.durationMinutes, niche: view.brief.niche })}
          </p>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("exampleRecommended")}</p>
            <p className="mt-1 text-lg font-semibold" lang={view.brief.language}>
              {recommended}
            </p>
          </div>
          <blockquote className="border-l-2 pl-4">
            <p className="text-sm font-medium text-muted-foreground">{t("exampleHook")}</p>
            <p className="mt-1" lang={view.brief.language}>
              {script.content!.scenes[0]!.narration}
            </p>
          </blockquote>
          <figcaption className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {t("exampleStats", {
                scenes: script.content!.scenes.length,
                titles: titles.content!.variants.length,
                chapters: seo.content!.chapters?.length ?? 0,
                seconds: meta.generationSeconds,
                cost: format.number(meta.costUsd, { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
              })}
            </span>
            <Link href={`/pipelines/${exampleId}`} className="font-medium text-foreground underline underline-offset-4">
              {t("exampleOpen")}
            </Link>
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="assets" className="grid gap-4">
        <h2 id="assets" className="text-2xl font-semibold tracking-tight">
          {t("assetsTitle")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ASSET_TYPES.map((type) => (
            <li key={type} className="rounded-xl border p-4">
              <h3 className="font-medium">{labels(`assets.${type}`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`assets.${type}`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="steps" className="grid gap-4">
        <h2 id="steps" className="text-2xl font-semibold tracking-tight">
          {t("stepsTitle")}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="rounded-xl border p-4">
              <span aria-hidden="true" className="text-sm font-medium text-muted-foreground">
                {index + 1}
              </span>
              <h3 className="font-medium">{t(`steps.${step}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${step}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pricing" className="grid gap-3 rounded-xl border p-5">
        <h2 id="pricing" className="text-2xl font-semibold tracking-tight">
          {t("pricingTitle")}
        </h2>
        <p className="text-muted-foreground">{t("pricingText", { credits: tenMinutes })}</p>
        <Link href="/pricing" className="w-fit font-medium underline underline-offset-4">
          {t("pricingLink")}
        </Link>
      </section>

      <section aria-labelledby="faq" className="grid gap-4">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">
          {t("faqTitle")}
        </h2>
        <div className="grid gap-2">
          {faq.map(({ question, answer }) => (
            <details key={question} className="rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">{question}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{answer}</p>
            </details>
          ))}
        </div>
        {/* Données structurées (guide Next « JSON-LD ») : nos propres messages, jamais du contenu
            utilisateur, avec `<` échappé pour que le JSON ne puisse pas fermer la balise. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }} />
      </section>

      <section aria-labelledby="demos">
        <h2 id="demos" className="mb-4 text-lg font-semibold">
          {t("demosTitle")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DEMOS.map((demo) => (
            <li key={demo}>
              <Link href={`/pipelines/demo-${demo}`} className="block rounded-xl border p-4 hover:bg-muted">
                <span className="font-medium">{t(`demos.${demo}.label`)}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{t(`demos.${demo}.description`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
