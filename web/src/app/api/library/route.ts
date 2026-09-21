import { requireUser } from "../../../server/auth/require-user";
import { errorResponse } from "../../../server/auth/http-error";
import { listLibrary, type LibraryStatus } from "../../../features/library/service";

const statuses = new Set<LibraryStatus>(["saved","used","discarded","draft","approved","published","failed","uncertain","in_progress"]);
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    if (rawStatus && !statuses.has(rawStatus as LibraryStatus)) return Response.json({ error: "Invalid status" }, { status: 400 });
    return Response.json(await listLibrary(user.id, { status: rawStatus as LibraryStatus | undefined, query: url.searchParams.get("query") ?? undefined }));
  } catch (error) { return errorResponse(error); }
}
