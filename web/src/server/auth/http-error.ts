import { ServerConfigurationError } from "../config-error";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  if (error instanceof ServerConfigurationError) {
    console.error(error.message);
    return Response.json(
      { error: "Service temporarily unavailable", code: "SERVER_CONFIGURATION_ERROR" },
      { status: 503 },
    );
  }
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
