import { NextResponse } from "next/server";
import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { beginLinkedInConnect } from "../../../../server/linkedin/oauth";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.redirect(await beginLinkedInConnect(user.id));
  } catch (error) { return errorResponse(error); }
}
