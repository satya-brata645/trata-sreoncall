import { setCurrentBuild } from "@/lib/builds/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  try {
    const body = await request.json() as { build?: unknown };
    if (!Number.isInteger(body.build)) return Response.json({ error: "build must be an integer" }, { status: 400 });
    return Response.json(await setCurrentBuild((await params).appId, body.build as number));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "could not set current build" }, { status: 400 });
  }
}
