import { ZodError } from "zod";
import { requireUser } from "../../../server/auth/require-user";
import { errorResponse } from "../../../server/auth/http-error";
import { createIdea, listIdeas } from "../../../features/ideas/service";
import { ideaStatus } from "../../../features/ideas/schema";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status");
    const status = statusValue ? ideaStatus.parse(statusValue) : undefined;
    return Response.json(await listIdeas(user.id, { query: url.searchParams.get("query") ?? undefined, status }));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid filter" }, { status: 400 });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return Response.json(await createIdea(user.id, await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Please enter an idea title" }, { status: 400 });
    return errorResponse(error);
  }
}
