import type { CreationRun } from "../server/db/types";
import type { CadenceAi, CadenceAiConfig } from "../server/ai/claude";
import { createCadenceAi } from "../server/ai/claude";
import { requireAllowedModel } from "../server/ai/model-catalog";
import { AiServiceError } from "../server/ai/provider-errors";
import { getAiRuntimeSettings, markAiSettingsInvalid } from "../features/settings/ai-settings";
import { failRun } from "../server/db/jobs";

type LoaderDependencies = {
  getSettings: typeof getAiRuntimeSettings;
  createAi: (config: CadenceAiConfig) => CadenceAi;
};

const loaderDefaults: LoaderDependencies = { getSettings: getAiRuntimeSettings, createAi: createCadenceAi };

export async function loadAiForRun(run: CreationRun, deps: LoaderDependencies = loaderDefaults) {
  if (!run.research_model || !run.writing_model || !run.ai_settings_revision) {
    throw new AiServiceError("AI_SETTINGS_REQUIRED", "Configure Claude in Settings before creating content.");
  }
  requireAllowedModel(run.research_model, "research");
  requireAllowedModel(run.writing_model, "writing");
  const settings = await deps.getSettings(run.owner_id);
  return {
    ai: deps.createAi({ apiKey: settings.apiKey, researchModel: run.research_model, writingModel: run.writing_model }),
    settingsRevision: settings.revision,
  };
}

type FailureDependencies = {
  markInvalid: typeof markAiSettingsInvalid;
  fail: typeof failRun;
};

const failureDefaults: FailureDependencies = { markInvalid: markAiSettingsInvalid, fail: failRun };

export async function handleRunFailure(
  run: CreationRun,
  error: unknown,
  settingsRevision: number | undefined,
  deps: FailureDependencies = failureDefaults,
): Promise<void> {
  let invalidationError: unknown;
  if (error instanceof AiServiceError && error.code === "AI_SETTINGS_INVALID" && settingsRevision !== undefined) {
    try { await deps.markInvalid(run.owner_id, settingsRevision); }
    catch (caught) { invalidationError = caught; }
  }
  await deps.fail(run.id, run.stage, error);
  if (invalidationError) throw invalidationError;
}
