import { HttpError } from "../auth/http-error";

export type AiErrorCode =
  | "AI_SETTINGS_REQUIRED"
  | "AI_SETTINGS_INVALID"
  | "AI_MODEL_NOT_ALLOWED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_CREDIT_REQUIRED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_OUTPUT_INCOMPLETE"
  | "AI_OUTPUT_INVALID";

function statusFor(code: AiErrorCode): number {
  if (code === "AI_RATE_LIMITED") return 429;
  if (code === "AI_CREDIT_REQUIRED") return 402;
  if (code === "AI_PROVIDER_UNAVAILABLE") return 503;
  if (code === "AI_OUTPUT_INCOMPLETE" || code === "AI_OUTPUT_INVALID") return 502;
  if (code === "AI_SETTINGS_REQUIRED" || code === "AI_SETTINGS_INVALID") return 409;
  return 400;
}

export class AiServiceError extends HttpError {
  constructor(public readonly code: AiErrorCode, message: string, public readonly providerRequestId?: string) {
    super(statusFor(code), message, code);
    this.name = "AiServiceError";
  }
}

type ProviderFailure = { status?: unknown; request_id?: unknown; requestId?: unknown; requestID?: unknown; message?: unknown; error?: { type?: unknown } };

export function mapAnthropicError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error;
  const failure = error && typeof error === "object" ? error as ProviderFailure : {};
  const status = typeof failure.status === "number" ? failure.status : undefined;
  const requestId = typeof failure.request_id === "string" ? failure.request_id : typeof failure.requestId === "string" ? failure.requestId : typeof failure.requestID === "string" ? failure.requestID : undefined;
  const providerType = typeof failure.error?.type === "string" ? failure.error.type : "";
  const message = typeof failure.message === "string" ? failure.message.toLowerCase() : "";
  if (status === 401) return new AiServiceError("AI_SETTINGS_INVALID", "Your Anthropic API key was rejected.", requestId);
  if (status === 403 || status === 404) return new AiServiceError("AI_MODEL_UNAVAILABLE", "Your Anthropic account cannot use the selected model.", requestId);
  if (status === 429) return new AiServiceError("AI_RATE_LIMITED", "Anthropic is rate limiting this account. Wait and try again.", requestId);
  if (status === 400 && (providerType.includes("billing") || message.includes("credit") || message.includes("billing"))) {
    return new AiServiceError("AI_CREDIT_REQUIRED", "Add Anthropic credit or resolve billing before trying again.", requestId);
  }
  return new AiServiceError("AI_PROVIDER_UNAVAILABLE", "Anthropic could not complete the request. Try again shortly.", requestId);
}
