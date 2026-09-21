import { requireUser } from "../../../server/auth/require-user";
import { errorResponse } from "../../../server/auth/http-error";
import { exportUserData } from "../../../server/export/user-export";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const format = new URL(request.url).searchParams.get("format") === "markdown" ? "markdown" : "json";
    const file = await exportUserData(user.id,format);
    return new Response(file.body,{ headers: { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
