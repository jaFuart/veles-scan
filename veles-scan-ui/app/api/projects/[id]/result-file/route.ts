import { NextRequest, NextResponse } from "next/server";
import { getCurrentViewer } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type ProjectJobRow = {
  user_id: string;
  pipeline_job_id: string | null;
};

type BackendResultPayload = {
  status?: string;
  result_key?: string | null;
  download_url?: string | null;
};

function extractFilename(resultKey: string | null | undefined): string {
  const key = (resultKey ?? "").trim();
  if (!key) {
    return "result.xlsx";
  }
  const parts = key.split("/");
  return parts[parts.length - 1] || "result.xlsx";
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await context.params;
  const project = await query<ProjectJobRow>(
    `SELECT p.user_id, ppj.pipeline_job_id::text AS pipeline_job_id
     FROM projects p
     LEFT JOIN project_pipeline_jobs ppj ON ppj.project_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [projectId],
  );
  const row = project.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (viewer.role !== "admin" && row.user_id !== viewer.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!row.pipeline_job_id) {
    return NextResponse.json({ error: "No pipeline job linked to project" }, { status: 404 });
  }

  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const resultResponse = await fetch(`${backendBase}/jobs/${row.pipeline_job_id}/result`, {
    method: "GET",
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!resultResponse.ok) {
    return NextResponse.json({ error: "Result is not available yet" }, { status: 409 });
  }
  const resultPayload = (await resultResponse.json()) as BackendResultPayload;
  const downloadUrl = (resultPayload.download_url ?? "").trim();
  if (!downloadUrl) {
    return NextResponse.json({ error: "Download URL is missing" }, { status: 404 });
  }

  const upstream = await fetch(downloadUrl, { method: "GET", cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Failed to download result file" }, { status: 502 });
  }

  const filename = extractFilename(resultPayload.result_key);
  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  return new NextResponse(upstream.body, { status: 200, headers });
}
