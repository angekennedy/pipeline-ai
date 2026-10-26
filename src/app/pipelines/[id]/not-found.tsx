import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

export default function PipelineNotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 text-center">
      <h1 className="text-xl font-semibold">{t("pipelineTitle")}</h1>
      <p className="mt-1 text-muted-foreground">{t("pipelineText")}</p>
      <Link href="/pipelines/new" className={buttonVariants({ className: "mt-6" })}>
        {t("createPipeline")}
      </Link>
    </main>
  );
}
