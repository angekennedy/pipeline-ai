"use client";

import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

const FEEDBACK_MS = 2000;

// Copie en un clic d'un texte brut. Le retour visuel est annoncé aux lecteurs d'écran.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed"); // permission refusée ou contexte non sécurisé
    }
  }

  const Icon = state === "copied" ? Check : state === "failed" ? TriangleAlert : Copy;
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Copié dans le presse-papiers" : state === "failed" ? "La copie a échoué" : ""}
      </span>
    </Button>
  );
}
