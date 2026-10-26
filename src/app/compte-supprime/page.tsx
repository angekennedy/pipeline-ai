import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("accountDeleted"), robots: { index: false } };
}

export default function AccountDeletedPage() {
  const t = useTranslations("AccountDeleted");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("text")}</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        {t("home")}
      </Link>
    </main>
  );
}
