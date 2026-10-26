import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocument } from "@/components/legal/legal-document";
import { LEGAL_PATHS } from "@/lib/legal";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${(await getTranslations("Legal"))("usage.title")} · Pipeline AI`, alternates: { canonical: LEGAL_PATHS.usage } };
}

export default function UsagePage() {
  return <LegalDocument page="usage" />;
}
