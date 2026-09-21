import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { getConnectionStatus } from "../../../../server/linkedin/oauth";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await getConnectionStatus(user.id));
  } catch (error) { return errorResponse(error); }
}
