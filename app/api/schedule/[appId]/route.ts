import { deleteSchedule, getSchedule, putSchedule } from "@/lib/schedule/store";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  return Response.json({ schedule: await getSchedule((await params).appId) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  try { return Response.json({ schedule: await putSchedule((await params).appId, await request.json()) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "invalid schedule" }, { status: 400 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  await deleteSchedule((await params).appId);
  return new Response(null, { status: 204 });
}
