import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocument } from "@/components/legal/legal-document";
import { LEGAL_PATHS } from "@/lib/legal";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${(await getTranslations("Legal"))("terms.title")} · Pipeline AI`, alternates: { canonical: LEGAL_PATHS.terms } };
}

export default function TermsPage() {
  return <LegalDocument page="terms" />;
}
