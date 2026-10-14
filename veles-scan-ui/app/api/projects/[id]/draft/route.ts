import { NextRequest, NextResponse } from "next/server";
import { getCurrentViewer } from "@/lib/auth";
import { updateProjectDraft } from "@/lib/repositories";

export const dynamic = "force-dynamic";

type DraftUpdatePayload = {
  title?: string;
  description?: string;
  columns?: string;
  mode?: "save" | "save_and_price";
  clientEditedAtMs?: number;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await context.params;

  let payload: DraftUpdatePayload;
  try {
    payload = (await request.json()) as DraftUpdatePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(payload.title ?? "");
  const description = String(payload.description ?? "");
  const columns = String(payload.columns ?? "");
  const mode = payload.mode === "save" ? "save" : "save_and_price";
  const clientEditedAtMs = Number.isFinite(payload.clientEditedAtMs)
    ? Math.max(0, Math.trunc(Number(payload.clientEditedAtMs)))
    : Date.now();

  const updated = await updateProjectDraft(
    viewer.role === "admin" ? null : viewer.id,
    projectId,
    { title, description, columns },
    { recalculatePrice: mode === "save_and_price", editedAtMs: clientEditedAtMs },
  );

  if (!updated) {
    return NextResponse.json({ error: "Недоступно для редактирования" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, pricing: updated.pricing });
}
