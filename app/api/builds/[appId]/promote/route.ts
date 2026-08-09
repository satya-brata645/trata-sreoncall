import { promoteBuild } from "@/lib/builds/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  try {
    return Response.json(await promoteBuild((await params).appId, await request.json().catch(() => ({}))));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "could not promote build" }, { status: 400 });
  }
}
