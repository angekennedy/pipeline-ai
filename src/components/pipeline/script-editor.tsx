"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { saveScript, type ScriptEditState } from "@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions";
import type { Scene, Script } from "@/lib/ai/schemas";
import { NEW_SCENE, SCENE_ORDER_FIELD, sceneFieldName } from "@/lib/pipeline/script-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineActionsValue } from "./pipeline-actions";

function Field({
  name,
  label,
  error,
  hint,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; name: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const described = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children({ id: name, name, "aria-invalid": error ? true : undefined, "aria-describedby": described })}
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

// Bornes de ScriptSchema : 3 à 80 scènes.
const MIN_SCENES = 3;
const MAX_SCENES = 80;

// Scène affichée : `source` est l'index d'origine, ou `new` pour une scène ajoutée ; `key` reste
// stable quand la scène bouge, pour que le texte déjà tapé la suive.
type SceneSlot = { key: string; source: number | typeof NEW_SCENE };
let added = 0;
const newSlot = (): SceneSlot => ({ key: `new-${++added}`, source: NEW_SCENE });

const EMPTY_SCENE: Pick<Scene, "purpose" | "title" | "narration" | "visualDirection" | "onScreenText"> = {
  purpose: "development",
  title: "",
  narration: "",
  visualDirection: "",
  onScreenText: null,
};

// Édition du script dans la page (tâche 4.2) : une nouvelle version `user_edit`, gratuite, que les
// régénérations des dérivés et la vidéo utilisent ensuite. Les scènes peuvent être ajoutées,
// supprimées ou déplacées. La durée des scènes est recalculée à l'enregistrement.
export function ScriptEditor({ script, actions, onDone }: { script: Script; actions: PipelineActionsValue; onDone: () => void }) {
  const [slots, setSlots] = useState<SceneSlot[]>(() => script.scenes.map((scene) => ({ key: `scene-${scene.index}`, source: scene.index })));
  const insertAfter = (position: number) => setSlots((list) => [...list.slice(0, position + 1), newSlot(), ...list.slice(position + 1)]);
  const remove = (position: number) => setSlots((list) => list.filter((_, i) => i !== position));
  const move = (position: number, offset: -1 | 1) =>
    setSlots((list) => {
      const next = [...list];
      [next[position], next[position + offset]] = [next[position + offset]!, next[position]!];
      return next;
    });
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
      <input type="hidden" name={SCENE_ORDER_FIELD} value={slots.map((slot) => slot.source).join(",")} />

      <div className="grid gap-4">
        <Field name="workingTitle" label={t("workingTitle")} error={errors.workingTitle}>
          {(props) => <Input {...props} defaultValue={script.workingTitle} maxLength={100} />}
        </Field>
        <Field name="hookSummary" label={t("hookSummary")} error={errors.hookSummary}>
          {(props) => <Textarea {...props} defaultValue={script.hookSummary} maxLength={300} rows={2} />}
        </Field>
      </div>

      <ol className="grid gap-4">
        {slots.map((slot, i) => {
          const scene = slot.source === NEW_SCENE ? EMPTY_SCENE : script.scenes[slot.source - 1]!;
          const index = i + 1;
          const name = (field: Parameters<typeof sceneFieldName>[1]) => sceneFieldName(index, field);
          return (
            <li key={slot.key}>
              <fieldset className="grid gap-3 rounded-xl border p-4">
                <legend className="px-1 text-sm font-medium">{t("scene", { index, purpose: labels(`scenePurpose.${scene.purpose}`) })}</legend>
                <Field name={name("title")} label={t("title")} error={errors[name("title")]}>
                  {(props) => <Input {...props} defaultValue={scene.title} maxLength={80} />}
                </Field>
                <Field name={name("narration")} label={t("narration")} error={errors[name("narration")]} hint={t("narrationHint")}>
                  {(props) => <Textarea {...props} defaultValue={scene.narration} rows={4} required minLength={20} />}
                </Field>
                <Field name={name("visualDirection")} label={t("visualDirection")} error={errors[name("visualDirection")]} hint={t("visualDirectionHint")}>
                  {(props) => <Textarea {...props} defaultValue={scene.visualDirection} maxLength={1000} rows={3} />}
                </Field>
                <Field name={name("onScreenText")} label={t("onScreenText")} error={errors[name("onScreenText")]}>
                  {(props) => <Input {...props} defaultValue={scene.onScreenText ?? ""} maxLength={60} />}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="xs" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("moveUp", { index })}>
                    {t("up")}
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => move(i, 1)} disabled={i === slots.length - 1} aria-label={t("moveDown", { index })}>
                    {t("down")}
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => insertAfter(i)} disabled={slots.length >= MAX_SCENES} aria-label={t("addAfter", { index })}>
                    {t("add")}
                  </Button>
                  <Button type="button" variant="ghost" size="xs" onClick={() => remove(i)} disabled={slots.length <= MIN_SCENES} aria-label={t("removeScene", { index })}>
                    {t("remove")}
                  </Button>
                </div>
              </fieldset>
            </li>
          );
        })}
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
