"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { saveScript, type ScriptEditState } from "@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions";
import type { Script } from "@/lib/ai/schemas";
import { sceneFieldName } from "@/lib/pipeline/script-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineActionsValue } from "./pipeline-actions";

function Field({ name, label, error, children }: { name: string; label: string; error?: string; children: (props: { id: string; name: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children({ id: name, name, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${name}-error` : undefined })}
      {error && (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// Édition du script dans la page (tâche 4.2) : une nouvelle version `user_edit`, gratuite, que les
// régénérations des dérivés utilisent ensuite. La durée des scènes est recalculée à l'enregistrement.
export function ScriptEditor({ script, actions, onDone }: { script: Script; actions: PipelineActionsValue; onDone: () => void }) {
  const [state, action, pending] = useActionState<ScriptEditState, FormData>(saveScript, { fieldErrors: {} });
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    if (state.saved) onDone();
  }
  const t = useTranslations("ScriptEditor");
  const labels = useTranslations("Labels");
  const errors = Object.fromEntries(Object.entries(state.fieldErrors).map(([name, field]) => [name, t(`errors.${field}`)]));

  return (
    <form action={action} className="grid gap-6" aria-label={t("form")}>
      <input type="hidden" name="workspaceSlug" value={actions.workspaceSlug} />
      <input type="hidden" name="pipelineId" value={actions.pipelineId} />

      <div className="grid gap-4">
        <Field name="workingTitle" label={t("workingTitle")} error={errors.workingTitle}>
          {(props) => <Input {...props} defaultValue={script.workingTitle} maxLength={100} />}
        </Field>
        <Field name="hookSummary" label={t("hookSummary")} error={errors.hookSummary}>
          {(props) => <Textarea {...props} defaultValue={script.hookSummary} maxLength={300} rows={2} />}
        </Field>
      </div>

      <ol className="grid gap-4">
        {script.scenes.map((scene) => (
          <li key={scene.index}>
            <fieldset className="grid gap-3 rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">
                {t("scene", { index: scene.index, purpose: labels(`scenePurpose.${scene.purpose}`) })}
              </legend>
              <Field name={sceneFieldName(scene.index, "title")} label={t("title")} error={errors[sceneFieldName(scene.index, "title")]}>
                {(props) => <Input {...props} defaultValue={scene.title} maxLength={80} />}
              </Field>
              <Field name={sceneFieldName(scene.index, "narration")} label={t("narration")} error={errors[sceneFieldName(scene.index, "narration")]}>
                {(props) => <Textarea {...props} defaultValue={scene.narration} rows={4} />}
              </Field>
              <Field
                name={sceneFieldName(scene.index, "visualDirection")}
                label={t("visualDirection")}
                error={errors[sceneFieldName(scene.index, "visualDirection")]}
              >
                {(props) => <Textarea {...props} defaultValue={scene.visualDirection} maxLength={400} rows={2} />}
              </Field>
              <Field
                name={sceneFieldName(scene.index, "onScreenText")}
                label={t("onScreenText")}
                error={errors[sceneFieldName(scene.index, "onScreenText")]}
              >
                {(props) => <Input {...props} defaultValue={scene.onScreenText ?? ""} maxLength={60} />}
              </Field>
            </fieldset>
          </li>
        ))}
      </ol>

      <Field name="callToAction" label={t("callToAction")} error={errors.callToAction}>
        {(props) => <Textarea {...props} defaultValue={script.callToAction} maxLength={300} rows={2} />}
      </Field>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("note")}</p>
      </div>
    </form>
  );
}
