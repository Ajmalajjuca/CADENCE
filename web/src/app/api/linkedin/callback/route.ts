import { NextResponse } from "next/server";
import { requireUser } from "../../../../server/auth/require-user";
import { finishLinkedInConnect } from "../../../../server/linkedin/oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/settings",url);
  if (url.searchParams.has("error")) { destination.searchParams.set("result","denied"); return NextResponse.redirect(destination); }
  try {
    const user = await requireUser();
    await finishLinkedInConnect(user.id,url.searchParams.get("state") ?? "",url.searchParams.get("code") ?? "");
    destination.searchParams.set("result","connected");
  } catch { destination.searchParams.set("result","failed"); }
  return NextResponse.redirect(destination);
}
