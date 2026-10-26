"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveChannel, type ChannelFormState } from "@/app/(app)/w/[workspaceSlug]/channels/actions";
import { LANGUAGES, STYLES, TONES } from "@/lib/ai/schemas";
import { restrictionMessage } from "@/lib/billing/entitlements";
import type { ChannelFormField, ChannelFormValues } from "@/lib/channels/form";
import { LANGUAGE_LABELS, PACE_LABELS, STYLE_LABELS, TONE_LABELS } from "@/lib/pipeline/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

const GENDER_LABELS = { male: "Masculine", female: "Féminine", neutral: "Neutre" } as const;

type FieldProps = { id: string; name: string; "aria-invalid"?: true; "aria-describedby"?: string };

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: ChannelFormField;
  label: string;
  hint?: string;
  error?: string;
  children: (props: FieldProps) => React.ReactNode;
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

function Choice<T extends string>({
  props,
  value,
  options,
  labels,
  empty,
}: {
  props: FieldProps;
  value?: string;
  options: readonly T[];
  labels: Record<T, string>;
  empty?: string;
}) {
  // Clé sur la valeur : React ne réapplique pas le defaultValue d'un <select> déjà monté, que la
  // réinitialisation du formulaire après l'action ramènerait sinon à sa première valeur.
  return (
    <select key={value ?? ""} {...props} defaultValue={value ?? ""} className={SELECT_CLASS}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option]}
        </option>
      ))}
    </select>
  );
}

// Création (sans `channelId`) ou modification d'un preset de chaîne.
export function ChannelForm({
  workspaceSlug,
  channelId,
  initialValues = {},
}: {
  workspaceSlug: string;
  channelId?: string;
  initialValues?: ChannelFormValues;
}) {
  const [state, formAction, pending] = useActionState<ChannelFormState, FormData>(saveChannel, { fieldErrors: {}, values: initialValues });
  const { fieldErrors: errors, values } = state;

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {channelId && <input type="hidden" name="channelId" value={channelId} />}

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-medium">Identité de la chaîne</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field name="name" label="Nom du preset" error={errors.name}>
            {(props) => <Input {...props} defaultValue={values.name} required maxLength={80} />}
          </Field>
          <Field name="niche" label="Niche" hint="Reprise dans chaque brief créé avec ce preset." error={errors.niche}>
            {(props) => <Input {...props} defaultValue={values.niche} required maxLength={80} />}
          </Field>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <Field name="defaultLanguage" label="Langue" error={errors.defaultLanguage}>
            {(props) => <Choice props={props} value={values.defaultLanguage ?? "fr"} options={LANGUAGES} labels={LANGUAGE_LABELS} />}
          </Field>
          <Field name="tone" label="Ton" error={errors.tone}>
            {(props) => <Choice props={props} value={values.tone} options={TONES} labels={TONE_LABELS} empty="Au choix du brief" />}
          </Field>
          <Field name="style" label="Style" error={errors.style}>
            {(props) => <Choice props={props} value={values.style} options={STYLES} labels={STYLE_LABELS} empty="Au choix du brief" />}
          </Field>
        </div>
        <Field name="audience" label="Public visé (facultatif)" error={errors.audience}>
          {(props) => <Input {...props} defaultValue={values.audience} maxLength={200} />}
        </Field>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-medium">Voix off</legend>
        <div className="grid gap-5 md:grid-cols-4">
          <Field name="voiceGender" label="Voix" error={errors.voiceGender}>
            {(props) => <Choice props={props} value={values.voiceGender} options={["male", "female", "neutral"] as const} labels={GENDER_LABELS} empty="Libre" />}
          </Field>
          <Field name="voiceAge" label="Âge" error={errors.voiceAge}>
            {(props) => <Input {...props} defaultValue={values.voiceAge} maxLength={20} placeholder="35-45" />}
          </Field>
          <Field name="voiceAccent" label="Accent" error={errors.voiceAccent}>
            {(props) => <Input {...props} defaultValue={values.voiceAccent} maxLength={60} />}
          </Field>
          <Field name="voicePace" label="Rythme" error={errors.voicePace}>
            {(props) => <Choice props={props} value={values.voicePace} options={["slow", "medium", "fast"] as const} labels={PACE_LABELS} empty="Libre" />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-medium">Règles de marque</legend>
        <Field
          name="bannedWords"
          label="Mots interdits"
          hint="Séparés par des virgules. Jamais utilisés dans le script, les titres ni le SEO."
          error={errors.bannedWords}
        >
          {(props) => <Textarea {...props} defaultValue={values.bannedWords} rows={2} />}
        </Field>
        <Field name="ctaTemplate" label="Appel à l'action" hint="Adapté à la fin de chaque script." error={errors.ctaTemplate}>
          {(props) => <Input {...props} defaultValue={values.ctaTemplate} maxLength={300} />}
        </Field>
        <Field
          name="thumbnailPalette"
          label="Palette des miniatures"
          hint="Jusqu'à 6 couleurs #RRGGBB, séparées par des virgules."
          error={errors.thumbnailPalette}
        >
          {(props) => <Input {...props} defaultValue={values.thumbnailPalette} placeholder="#FFD400, #000000" />}
        </Field>
      </fieldset>

      {state.restriction && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p>{restrictionMessage(state.restriction)}</p>
          <Link href="/pricing" className="mt-2 inline-block font-medium underline underline-offset-4">
            Voir les tarifs
          </Link>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : channelId ? "Enregistrer le preset" : "Créer le preset"}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {Object.keys(errors).length > 0 ? "Corrigez les champs signalés." : ""}
        </p>
      </div>
    </form>
  );
}
