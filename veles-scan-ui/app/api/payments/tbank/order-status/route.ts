import { NextRequest, NextResponse } from "next/server";
import { getCurrentViewer } from "@/lib/auth";
import { getTBankTopupForUserByOrder } from "@/lib/repositories";

function isCancelledStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return (
    normalized.includes("CANCEL") ||
    normalized === "REJECTED" ||
    normalized === "DEADLINE_EXPIRED" ||
    normalized === "FAILED"
  );
}

function isSuccessfulStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "CONFIRMED" || normalized === "COMPLETED" || normalized === "CREDITED";
}

export async function GET(request: NextRequest) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: "Требуется авторизация" }, { status: 401 });
  }

  const orderId = (request.nextUrl.searchParams.get("orderId") ?? "").trim();
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId обязателен" }, { status: 400 });
  }

  const topup = await getTBankTopupForUserByOrder(orderId, viewer.id);
  if (!topup) {
    return NextResponse.json({ ok: false, error: "Платёж не найден" }, { status: 404 });
  }

  const successful = Boolean(topup.credited_at) || isSuccessfulStatus(topup.status);
  const cancelled = isCancelledStatus(topup.status);

  return NextResponse.json({
    ok: true,
    status: topup.status,
    successful,
    cancelled,
    needsCancel: !successful && !cancelled,
  });
}
