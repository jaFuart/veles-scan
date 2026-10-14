import { NextRequest, NextResponse } from "next/server";
import { getCurrentViewer } from "@/lib/auth";
import { getTBankTopupForUserByOrder, saveTBankCancelResponse } from "@/lib/repositories";
import { buildTBankToken, getTBankCancelUrl } from "@/lib/tbank";

type CancelResponse = {
  Success?: boolean;
  Status?: string;
  Message?: string;
  Details?: string;
};

export async function POST(request: NextRequest) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: "Требуется авторизация" }, { status: 401 });
  }

  const terminalKey = (process.env.TBANK_TERMINAL_KEY ?? "").trim();
  const password = (process.env.TBANK_PASSWORD ?? "").trim();
  if (!terminalKey || !password) {
    return NextResponse.json({ ok: false, error: "Интеграция Т-Банка не настроена" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректное тело запроса" }, { status: 400 });
  }

  const orderId = typeof (body as { orderId?: unknown }).orderId === "string" ? (body as { orderId: string }).orderId.trim() : "";
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId обязателен" }, { status: 400 });
  }

  const topup = await getTBankTopupForUserByOrder(orderId, viewer.id);
  if (!topup) {
    return NextResponse.json({ ok: false, error: "Платёж не найден" }, { status: 404 });
  }

  if (topup.credited_at) {
    return NextResponse.json({ ok: false, error: "Платёж уже подтверждён и зачислен" }, { status: 409 });
  }

  if (!topup.payment_id) {
    await saveTBankCancelResponse({
      orderId,
      status: "cancelled_local",
      cancelPayload: { source: "ui", reason: "no_payment_id" },
    });
    return NextResponse.json({ ok: true, cancelled: true, providerStatus: "cancelled_local" });
  }

  const cancelPayload: Record<string, unknown> = {
    TerminalKey: terminalKey,
    PaymentId: topup.payment_id,
  };
  cancelPayload.Token = buildTBankToken(cancelPayload, password);

  let response: Response;
  try {
    response = await fetch(getTBankCancelUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cancelPayload),
      cache: "no-store",
    });
  } catch {
    await saveTBankCancelResponse({
      orderId,
      status: "cancel_request_error",
      cancelPayload: { error: "network" },
    });
    return NextResponse.json({ ok: false, error: "Не удалось отправить отмену в Т-Банк" }, { status: 502 });
  }

  let cancelResult: CancelResponse;
  try {
    cancelResult = (await response.json()) as CancelResponse;
  } catch {
    await saveTBankCancelResponse({
      orderId,
      status: "cancel_invalid_response",
      cancelPayload: { error: "invalid_json", status: response.status },
    });
    return NextResponse.json({ ok: false, error: "Некорректный ответ Т-Банка при отмене" }, { status: 502 });
  }

  const providerStatus = typeof cancelResult.Status === "string" && cancelResult.Status.trim() ? cancelResult.Status : "cancel_failed";
  const isCancelled = Boolean(cancelResult.Success);

  await saveTBankCancelResponse({
    orderId,
    status: isCancelled ? "cancelled" : providerStatus,
    cancelPayload: cancelResult,
  });

  if (!isCancelled) {
    return NextResponse.json(
      {
        ok: false,
        error: cancelResult.Message || cancelResult.Details || "Т-Банк не подтвердил отмену",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, cancelled: true, providerStatus });
}
