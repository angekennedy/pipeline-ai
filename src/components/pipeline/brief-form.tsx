"use client";

import { useActionState, useState } from "react";
import { createPipeline, type CreatePipelineState } from "@/app/pipelines/new/actions";
import { LANGUAGES, STYLES, TONES } from "@/lib/ai/schemas";
import type { CreditSummary } from "@/lib/billing/balance";
import type { BriefFormField } from "@/lib/pipeline/brief-form";
import type { ModelTier } from "@/lib/pipeline/registry";
import { CostEstimate } from "@/components/billing/cost-estimate";
import { InsufficientCreditsDialog } from "@/components/billing/insufficient-credits-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const LANGUAGE_LABELS: Record<(typeof LANGUAGES)[number], string> = {
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
  pt: "Portugais",
  de: "Allemand",
  it: "Italien",
};

const TONE_LABELS: Record<(typeof TONES)[number], string> = {
  educational: "Pédagogique",
  dramatic: "Dramatique",
  humorous: "Humoristique",
  mysterious: "Mystérieux",
  inspirational: "Inspirant",
  neutral: "Neutre",
};

const STYLE_LABELS: Record<(typeof STYLES)[number], string> = {
  listicle: "Liste",
  storytelling: "Récit",
  documentary: "Documentaire",
  explainer: "Explication",
  "top-n": "Top N",
  "true-crime": "Faits divers",
};

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

const initialState: CreatePipelineState = { fieldErrors: {}, values: {} };

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: BriefFormField;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; name: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children({ id: name, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function BriefForm({ credits }: { credits: CreditSummary }) {
  const [state, formAction, pending] = useActionState(createPipeline, initialState);
  const { fieldErrors: errors, values } = state;

  // Durée et formule suivies en direct pour afficher le coût. Chaque réponse de la Server Action
  // réinitialise le formulaire avec la saisie renvoyée : on s'y recale, et le modal s'ouvre si la
  // réservation a échoué faute de crédits.
  const [duration, setDuration] = useState(values.durationMinutes ?? "8");
  const [tier, setTier] = useState<ModelTier>("standard");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    setDuration(values.durationMinutes ?? "8");
    setTier(values.tier === "premium" ? "premium" : "standard");
    setDialogOpen(Boolean(state.insufficient));
  }

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <div className="grid gap-5 md:grid-cols-2">
        <Field name="niche" label="Niche" hint="Le thème de la chaîne, par exemple Histoire ou Finances personnelles." error={errors.niche}>
          {(props) => <Input {...props} defaultValue={values.niche} required maxLength={80} />}
        </Field>
        <Field name="durationMinutes" label="Durée cible (minutes)" error={errors.durationMinutes}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              defaultValue={values.durationMinutes ?? "8"}
              onChange={(event) => setDuration(event.target.value)}
              required
            />
          )}
        </Field>
      </div>

      <Field name="topic" label="Sujet de la vidéo" hint="Une question ou un angle précis donne un meilleur script." error={errors.topic}>
        {(props) => <Textarea {...props} defaultValue={values.topic} required maxLength={300} rows={2} />}
      </Field>

      <div className="grid gap-5 md:grid-cols-3">
        <Field name="language" label="Langue" error={errors.language}>
          {(props) => (
            <select {...props} defaultValue={values.language ?? "fr"} className={SELECT_CLASS}>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {LANGUAGE_LABELS[language]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="tone" label="Ton" error={errors.tone}>
          {(props) => (
            <select {...props} defaultValue={values.tone ?? "educational"} className={SELECT_CLASS}>
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABELS[tone]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="style" label="Style" error={errors.style}>
          {(props) => (
            <select {...props} defaultValue={values.style ?? "documentary"} className={SELECT_CLASS}>
              {STYLES.map((style) => (
                <option key={style} value={style}>
                  {STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field name="targetAudience" label="Public visé (facultatif)" error={errors.targetAudience}>
        {(props) => <Input {...props} defaultValue={values.targetAudience} maxLength={200} />}
      </Field>

      <Field
        name="extraNotes"
        label="Consignes supplémentaires (facultatif)"
        hint="Points à aborder ou à éviter, sources à privilégier."
        error={errors.extraNotes}
      >
        {(props) => <Textarea {...props} defaultValue={values.extraNotes} maxLength={2000} rows={3} />}
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Formule</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="tier" value="standard" defaultChecked={values.tier !== "premium"} onChange={() => setTier("standard")} />
          Standard : script rédigé par Claude Sonnet
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="tier" value="premium" defaultChecked={values.tier === "premium"} onChange={() => setTier("premium")} />
          Premium : script rédigé par Claude Opus, plus de crédits
        </label>
        {errors.tier && <p className="text-sm text-destructive">{errors.tier}</p>}
      </fieldset>

      <CostEstimate durationMinutes={Number(duration.trim() || Number.NaN)} tier={tier} available={credits.available} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Lancement…" : "Générer le pipeline"}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {Object.keys(errors).length > 0 ? "Corrigez les champs signalés." : ""}
        </p>
      </div>
      {state.insufficient && (
        <InsufficientCreditsDialog open={dialogOpen} onOpenChange={setDialogOpen} {...state.insufficient} />
      )}
    </form>
  );
}
