import { HttpError } from "../auth/http-error";

export type AiModelRole = "research" | "writing";
export type AiModelOption = {
  id: string;
  label: string;
  description: string;
  roles: readonly AiModelRole[];
  recommended: boolean;
};

export const AI_MODEL_CATALOG = [
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Fast, balanced quality and cost",
    roles: ["research", "writing"],
    recommended: true,
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Higher quality with higher cost",
    roles: ["research", "writing"],
    recommended: false,
  },
] as const satisfies readonly AiModelOption[];

export function listModels(role?: AiModelRole): AiModelOption[] {
  return AI_MODEL_CATALOG.filter(model => !role || model.roles.includes(role)).map(model => ({ ...model, roles: [...model.roles] }));
}

export function requireAllowedModel(id: string, role: AiModelRole): AiModelOption {
  const model = AI_MODEL_CATALOG.find(option => option.id === id && option.roles.includes(role));
  if (!model) throw new HttpError(400, "Choose a supported Claude model", "AI_MODEL_NOT_ALLOWED");
  return { ...model, roles: [...model.roles] };
}
