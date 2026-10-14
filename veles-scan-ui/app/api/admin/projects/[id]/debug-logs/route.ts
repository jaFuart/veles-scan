import { NextRequest, NextResponse } from "next/server";
import { getCurrentViewer } from "@/lib/auth";
import { getProjectDebugLogsForAdmin } from "@/lib/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await context.params;
  const sinceIdRaw = request.nextUrl.searchParams.get("sinceId");
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const sinceId = sinceIdRaw ? Number(sinceIdRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const data = await getProjectDebugLogsForAdmin(projectId, {
    sinceId: Number.isFinite(sinceId) ? sinceId : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return NextResponse.json(data);
}
