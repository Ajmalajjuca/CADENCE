export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
