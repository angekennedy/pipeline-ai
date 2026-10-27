"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import { createPipeline, type CreatePipelineState } from "@/app/(app)/w/[workspaceSlug]/pipelines/new/actions";
import { LANGUAGES, STYLES, TONES } from "@/lib/ai/schemas";
import type { CreditSummary } from "@/lib/billing/balance";
import { restrictionMessage } from "@/lib/billing/entitlements";
import { VIDEO_CREDITS_PER_MINUTE } from "@/lib/billing/credit-rules";
import { PLANS, PLAN_KEYS } from "@/lib/billing/plans";
import { briefPrefill, type ChannelOption } from "@/lib/channels/form";
import type { BriefFormField, BriefFormValues } from "@/lib/pipeline/brief-form";
import type { ModelTier } from "@/lib/pipeline/registry";
import { SAMPLE_BRIEF_KEYS, SAMPLE_DURATION_MINUTES, sampleBriefValues } from "@/lib/pipeline/sample-briefs";
import type { Language } from "@/lib/ai/schemas";
import { CostEstimate } from "@/components/billing/cost-estimate";
import { InsufficientCreditsDialog } from "@/components/billing/insufficient-credits-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

// Premier plan qui inclut le script Premium, nommé à côté de l'option quand elle est grisée.
const PREMIUM_PLAN = PLAN_KEYS.map((key) => PLANS[key]).find((plan) => plan.premium)?.name;
// Premier plan qui inclut la vidéo, même usage.
const VIDEO_PLAN = PLAN_KEYS.map((key) => PLANS[key]).find((plan) => plan.video)?.name;

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

// `initialValues` préremplit le formulaire (duplication d'un brief depuis le tableau de bord).
// `channels` : presets du workspace ; en choisir un préremplit le brief.
// `showSamples` : briefs d'exemple en un clic (onboarding, tâche 5.4), pour un formulaire vierge.
// `videoAvailable` : voix et rendu vidéo configurés sur le serveur (media/config).
export function BriefForm({
  workspaceSlug,
  credits,
  idempotencyKey,
  initialValues = {},
  channels = [],
  showSamples = false,
  videoAvailable = false,
}: {
  workspaceSlug: string;
  credits: CreditSummary;
  idempotencyKey: string;
  initialValues?: BriefFormValues;
  channels?: ChannelOption[];
  showSamples?: boolean;
  videoAvailable?: boolean;
}) {
  const [state, formAction, pending] = useActionState<CreatePipelineState, FormData>(createPipeline, { fieldErrors: {}, values: initialValues });
  const t = useTranslations("BriefForm");
  const labels = useTranslations("Labels");
  const restriction = useTranslations("Restriction");
  const limits = useTranslations("Limits");
  const onboarding = useTranslations("Onboarding");
  const locale = useLocale() as Language;
  const { values } = state;
  const errors = Object.fromEntries(Object.keys(state.fieldErrors).map((field) => [field, t(`errors.${field as keyof typeof state.fieldErrors}`)])) as Partial<
    Record<keyof typeof state.fieldErrors, string>
  >;
  const plan = PLANS[credits.planKey];
  // Premium n'est retenu que si le plan l'inclut : l'option grisée ne serait pas envoyée.
  const tierOf = (input: BriefFormValues): ModelTier => (input.tier === "premium" && plan.premium ? "premium" : "standard");
  // Même règle pour la vidéo : la case grisée ne serait pas envoyée.
  const canVideo = plan.video && videoAvailable;
  const videoOf = (input: BriefFormValues) => canVideo && input.video === "on";

  // Durée et formule suivies en direct pour afficher le coût. Chaque réponse de la Server Action
  // réinitialise le formulaire avec la saisie renvoyée : on s'y recale, et le modal s'ouvre si la
  // réservation a échoué faute de crédits.
  const [duration, setDuration] = useState(values.durationMinutes ?? "8");
  const [tier, setTier] = useState<ModelTier>(tierOf(values));
  const [video, setVideo] = useState(videoOf(values));
  const [dialogOpen, setDialogOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Les champs gardent leur saisie (defaultValue) : un preset ou un exemple les remplace directement.
  // La formule (boutons radio) passe par RadioNodeList ; durée et formule suivies pour le coût.
  function fill(input: BriefFormValues) {
    const form = formRef.current;
    if (!form) return;
    for (const [field, value] of Object.entries(input)) {
      const element = form.elements.namedItem(field);
      if (element instanceof HTMLInputElement && element.type === "checkbox") element.checked = value === "on";
      else if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || element instanceof RadioNodeList) element.value = value ?? "";
    }
    if (input.durationMinutes) setDuration(input.durationMinutes);
    if (input.tier) setTier(tierOf(input));
    if (input.video !== undefined) setVideo(videoOf(input));
  }
  function applyPreset(channelId: string) {
    const option = channels.find((channel) => channel.id === channelId);
    if (option) fill(briefPrefill(option));
  }
  const samples = SAMPLE_BRIEF_KEYS.map((key) => ({
    key,
    label: onboarding(`samples.${key}.label`),
    values: sampleBriefValues(key, { niche: onboarding(`samples.${key}.niche`), topic: onboarding(`samples.${key}.topic`) }, locale),
  }));
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    setDuration(values.durationMinutes ?? "8");
    setTier(tierOf(values));
    setVideo(videoOf(values));
    setDialogOpen(Boolean(state.insufficient));
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-5" noValidate>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {showSamples && (
        <section aria-labelledby="samples" className="grid gap-2 rounded-xl border border-dashed p-4">
          <h2 id="samples" className="text-sm font-medium">
            {onboarding("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{onboarding("hint", { minutes: SAMPLE_DURATION_MINUTES })}</p>
          <div className="flex flex-wrap gap-2">
            {samples.map((sample) => (
              <Button key={sample.key} type="button" variant="outline" size="sm" onClick={() => fill(sample.values)}>
                {sample.label}
              </Button>
            ))}
          </div>
        </section>
      )}
      {channels.length > 0 ? (
        <Field
          name="channelId"
          label={t("channel")}
          hint={t("channelHint")}
          error={errors.channelId}
        >
          {(props) => (
            <select key={values.channelId} {...props} defaultValue={values.channelId ?? ""} onChange={(event) => applyPreset(event.target.value)} className={SELECT_CLASS}>
              <option value="">{t("noChannel")}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t.rich("createChannel", {
            link: (chunks) => (
              <Link href={`/w/${workspaceSlug}/channels/new`} className="font-medium underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Field name="niche" label={t("niche")} hint={t("nicheHint")} error={errors.niche}>
          {(props) => <Input {...props} defaultValue={values.niche} required maxLength={80} />}
        </Field>
        <Field
          name="durationMinutes"
          label={t("duration")}
          hint={t("durationHint", { max: plan.maxDurationMinutes, plan: plan.name })}
          error={errors.durationMinutes}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={plan.maxDurationMinutes}
              step={1}
              defaultValue={values.durationMinutes ?? "8"}
              onChange={(event) => setDuration(event.target.value)}
              required
            />
          )}
        </Field>
      </div>

      <Field name="topic" label={t("topic")} hint={t("topicHint")} error={errors.topic}>
        {(props) => <Textarea {...props} defaultValue={values.topic} required maxLength={300} rows={2} />}
      </Field>

      <div className="grid gap-5 md:grid-cols-3">
        <Field name="language" label={t("language")} error={errors.language}>
          {(props) => (
            <select key={values.language} {...props} defaultValue={values.language ?? "fr"} className={SELECT_CLASS}>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {labels(`language.${language}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="tone" label={t("tone")} error={errors.tone}>
          {(props) => (
            <select key={values.tone} {...props} defaultValue={values.tone ?? "educational"} className={SELECT_CLASS}>
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {labels(`tone.${tone}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="style" label={t("style")} error={errors.style}>
          {(props) => (
            <select key={values.style} {...props} defaultValue={values.style ?? "documentary"} className={SELECT_CLASS}>
              {STYLES.map((style) => (
                <option key={style} value={style}>
                  {labels(`style.${style}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field name="targetAudience" label={t("audience")} error={errors.targetAudience}>
        {(props) => <Input {...props} defaultValue={values.targetAudience} maxLength={200} />}
      </Field>

      <Field
        name="extraNotes"
        label={t("notes")}
        hint={t("notesHint")}
        error={errors.extraNotes}
      >
        {(props) => <Textarea {...props} defaultValue={values.extraNotes} maxLength={2000} rows={3} />}
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("tier")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="tier" value="standard" defaultChecked={tierOf(values) === "standard"} onChange={() => setTier("standard")} />
          {t("standard")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="tier"
            value="premium"
            defaultChecked={tierOf(values) === "premium"}
            disabled={!plan.premium}
            onChange={() => setTier("premium")}
          />
          {t("premium")}
          {!plan.premium && <span className="text-muted-foreground">{t("premiumPlan", { plan: PREMIUM_PLAN ?? "" })}</span>}
        </label>
        {errors.tier && <p className="text-sm text-destructive">{errors.tier}</p>}
      </fieldset>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">{t("video")}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="video"
            value="on"
            className="mt-0.5"
            defaultChecked={videoOf(values)}
            disabled={!canVideo}
            onChange={(event) => setVideo(event.target.checked)}
            aria-describedby="video-hint"
          />
          <span>
            {t("videoOption")}
            {!plan.video ? (
              <span className="ml-1 text-muted-foreground">{t("videoPlan", { plan: VIDEO_PLAN ?? "" })}</span>
            ) : (
              !videoAvailable && <span className="ml-1 text-muted-foreground">{t("videoUnavailable")}</span>
            )}
          </span>
        </label>
        <p id="video-hint" className="text-xs text-muted-foreground">
          {t("videoHint", { credits: VIDEO_CREDITS_PER_MINUTE })}
        </p>
      </fieldset>

      {state.launchError && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {t("launchError")}
        </p>
      )}

      {(state.rateLimited || state.spendPaused || state.moderated || state.moderationUnavailable) && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {state.rateLimited
            ? limits("rateLimited", state.rateLimited)
            : state.spendPaused
              ? limits("spendPaused")
              : state.moderated
                ? limits("moderated", { category: limits(`category.${state.moderated}`) })
                : limits("moderationUnavailable")}
        </p>
      )}

      {state.restriction && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p>{restrictionMessage(state.restriction, restriction)}</p>
          <Link href="/pricing" className="mt-2 inline-block font-medium underline underline-offset-4">
            {restriction("seePricing")}
          </Link>
        </div>
      )}

      <CostEstimate durationMinutes={Number(duration.trim() || Number.NaN)} tier={tier} video={video} thumbnailImages={plan.thumbnailImages} available={credits.available} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("launching") : t("submit")}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {Object.keys(errors).length > 0 ? t("fix") : ""}
        </p>
      </div>
      {state.insufficient && (
        <InsufficientCreditsDialog open={dialogOpen} onOpenChange={setDialogOpen} {...state.insufficient} />
      )}
    </form>
  );
}
