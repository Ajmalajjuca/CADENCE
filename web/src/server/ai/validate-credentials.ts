import Anthropic from "@anthropic-ai/sdk";
import { requireAllowedModel } from "./model-catalog";
import { AiServiceError, mapAnthropicError } from "./provider-errors";

type ModelInfo = { capabilities?: { structured_outputs?: { supported?: boolean } } | null };
export type ModelRetriever = { retrieve(modelId: string): Promise<ModelInfo> };

export async function validateAnthropicCredentials(
  apiKey: string,
  researchModel: string,
  writingModel: string,
  models: ModelRetriever = new Anthropic({ apiKey }).models,
): Promise<void> {
  requireAllowedModel(researchModel, "research");
  requireAllowedModel(writingModel, "writing");
  try {
    for (const modelId of new Set([researchModel, writingModel])) {
      const model = await models.retrieve(modelId);
      if (model.capabilities?.structured_outputs?.supported === false) {
        throw new AiServiceError("AI_MODEL_UNAVAILABLE", "The selected model does not support Cadence structured output.");
      }
    }
  } catch (error) {
    throw mapAnthropicError(error);
  }
}
