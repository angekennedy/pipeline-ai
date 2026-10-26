"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveChannel, type ChannelFormState } from "@/app/(app)/w/[workspaceSlug]/channels/actions";
import { LANGUAGES, STYLES, TONES } from "@/lib/ai/schemas";
import { restrictionMessage } from "@/lib/billing/entitlements";
import type { ChannelFormField, ChannelFormValues } from "@/lib/channels/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

const GENDERS = ["male", "female", "neutral"] as const;
const PACES = ["slow", "medium", "fast"] as const;
const labelsOf = <T extends string>(options: readonly T[], label: (option: T) => string) =>
  Object.fromEntries(options.map((option) => [option, label(option)])) as Record<T, string>;

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
  const t = useTranslations("ChannelForm");
  const labels = useTranslations("Labels");
  const restriction = useTranslations("Restriction");
  const { values } = state;
  const errors = Object.fromEntries(Object.keys(state.fieldErrors).map((field) => [field, t(`errors.${field as ChannelFormField}`)])) as Partial<
    Record<ChannelFormField, string>
  >;

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {channelId && <input type="hidden" name="channelId" value={channelId} />}

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-medium">{t("identity")}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field name="name" label={t("name")} error={errors.name}>
            {(props) => <Input {...props} defaultValue={values.name} required maxLength={80} />}
          </Field>
          <Field name="niche" label={t("niche")} hint={t("nicheHint")} error={errors.niche}>
            {(props) => <Input {...props} defaultValue={values.niche} required maxLength={80} />}
          </Field>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <Field name="defaultLanguage" label={t("language")} error={errors.defaultLanguage}>
            {(props) => <Choice props={props} value={values.defaultLanguage ?? "fr"} options={LANGUAGES} labels={labelsOf(LANGUAGES, (l) => labels(`language.${l}`))} />}
          </Field>
          <Field name="tone" label={t("tone")} error={errors.tone}>
            {(props) => <Choice props={props} value={values.tone} options={TONES} labels={labelsOf(TONES, (v) => labels(`tone.${v}`))} empty={t("briefChoice")} />}
          </Field>
          <Field name="style" label={t("style")} error={errors.style}>
            {(props) => <Choice props={props} value={values.style} options={STYLES} labels={labelsOf(STYLES, (v) => labels(`style.${v}`))} empty={t("briefChoice")} />}
          </Field>
        </div>
        <Field name="audience" label={t("audience")} error={errors.audience}>
          {(props) => <Input {...props} defaultValue={values.audience} maxLength={200} />}
        </Field>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-medium">{t("voiceSection")}</legend>
        <div className="grid gap-5 md:grid-cols-4">
          <Field name="voiceGender" label={t("voice")} error={errors.voiceGender}>
            {(props) => <Choice props={props} value={values.voiceGender} options={GENDERS} labels={labelsOf(GENDERS, (g) => t(`gender.${g}`))} empty={t("free")} />}
          </Field>
          <Field name="voiceAge" label={t("age")} error={errors.voiceAge}>
            {(props) => <Input {...props} defaultValue={values.voiceAge} maxLength={20} placeholder="35-45" />}
          </Field>
          <Field name="voiceAccent" label={t("accent")} error={errors.voiceAccent}>
            {(props) => <Input {...props} defaultValue={values.voiceAccent} maxLength={60} />}
          </Field>
          <Field name="voicePace" label={t("pace")} error={errors.voicePace}>
            {(props) => <Choice props={props} value={values.voicePace} options={PACES} labels={labelsOf(PACES, (p) => labels(`pace.${p}`))} empty={t("free")} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-medium">{t("brand")}</legend>
        <Field
          name="bannedWords"
          label={t("bannedWords")}
          hint={t("bannedWordsHint")}
          error={errors.bannedWords}
        >
          {(props) => <Textarea {...props} defaultValue={values.bannedWords} rows={2} />}
        </Field>
        <Field name="ctaTemplate" label={t("cta")} hint={t("ctaHint")} error={errors.ctaTemplate}>
          {(props) => <Input {...props} defaultValue={values.ctaTemplate} maxLength={300} />}
        </Field>
        <Field
          name="thumbnailPalette"
          label={t("palette")}
          hint={t("paletteHint")}
          error={errors.thumbnailPalette}
        >
          {(props) => <Input {...props} defaultValue={values.thumbnailPalette} placeholder="#FFD400, #000000" />}
        </Field>
      </fieldset>

      {state.restriction && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p>{restrictionMessage(state.restriction, restriction)}</p>
          <Link href="/pricing" className="mt-2 inline-block font-medium underline underline-offset-4">
            {restriction("seePricing")}
          </Link>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : channelId ? t("save") : t("create")}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {Object.keys(errors).length > 0 ? t("fix") : ""}
        </p>
      </div>
    </form>
  );
}
