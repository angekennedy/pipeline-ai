import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

// Page absente, ou appartenant à un workspace dont l'utilisateur n'est pas membre : même réponse,
// qui ne dit pas si la ressource existe.
export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("text")}</p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        {t("home")}
      </Link>
    </main>
  );
}
