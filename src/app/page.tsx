import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

// Pipelines de démonstration (src/lib/demo/pipelines.ts) ; libellés : Home.demos.
const DEMOS = ["running", "completed", "partial", "failed", "stale"] as const;

export default function Home() {
  const t = useTranslations("Home");
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-4 py-20">
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Pipeline AI</h1>
        <p className="max-w-md text-lg text-muted-foreground">{t("tagline")}</p>
        <Link href="/pipelines/new" className={buttonVariants({ size: "lg" })}>
          {t("create")}
        </Link>
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
