import { listBuilds } from "@/lib/builds/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  try {
    return Response.json(await listBuilds((await params).appId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid app id" }, { status: 400 });
  }
}
