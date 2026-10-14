import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentViewer } from "@/lib/auth";
import { createTBankTopupOrder, saveTBankInitResponse } from "@/lib/repositories";
import { buildTBankToken, getTBankInitUrl, parsePositiveInteger } from "@/lib/tbank";

type InitResponse = {
  Success?: boolean;
  PaymentURL?: string;
  PaymentId?: number | string;
  Status?: string;
  Message?: string;
  Details?: string;
  ErrorCode?: string;
};

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function resolvePublicBaseUrl(request: NextRequest): string {
  const originHeader = (request.headers.get("origin") ?? "").trim();
  if (originHeader) {
    return originHeader.replace(/\/$/, "");
  }

  const forwardedHost = (request.headers.get("x-forwarded-host") ?? "").trim();
  const host = forwardedHost || (request.headers.get("host") ?? "").trim();
  const forwardedProto = (request.headers.get("x-forwarded-proto") ?? "").trim();

  if (host) {
    const proto = forwardedProto || (request.nextUrl.protocol.replace(":", "") || "https");
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  const appPublicUrl = (process.env.APP_PUBLIC_URL ?? request.nextUrl.origin).trim();
  return appPublicUrl.replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: "Требуется авторизация" }, { status: 401 });
  }

  const terminalKey = (process.env.TBANK_TERMINAL_KEY ?? "").trim();
  const password = (process.env.TBANK_PASSWORD ?? "").trim();
  if (!terminalKey || !password) {
    return NextResponse.json(
      { ok: false, error: "Интеграция Т-Банка не настроена: проверьте TBANK_TERMINAL_KEY и TBANK_PASSWORD" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректное тело запроса" }, { status: 400 });
  }

  const amountRub = parsePositiveInteger((body as { amountRub?: unknown }).amountRub);
  if (!amountRub || amountRub < 10 || amountRub > 1_000_000) {
    return NextResponse.json({ ok: false, error: "Сумма должна быть от 10 до 1 000 000 руб." }, { status: 400 });
  }

  const appPublicUrl = resolvePublicBaseUrl(request);
  const orderId = `topup_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  await createTBankTopupOrder(viewer.id, amountRub, orderId);

  const notificationUrl =
    (process.env.TBANK_NOTIFICATION_URL ?? "").trim() || `${appPublicUrl}/api/payments/tbank/notification`;
  const successUrl = `${appPublicUrl}/payments/tbank/result?status=success&orderId=${encodeURIComponent(orderId)}`;
  const failUrl = `${appPublicUrl}/payments/tbank/result?status=fail&orderId=${encodeURIComponent(orderId)}`;

  const payload: Record<string, unknown> = {
    TerminalKey: terminalKey,
    Amount: amountRub * 100,
    OrderId: orderId,
    Description: `Пополнение баланса на ${amountRub} руб.`,
    NotificationURL: notificationUrl,
    SuccessURL: successUrl,
    FailURL: failUrl,
    DATA: {
      userId: viewer.id,
      source: "veles-scan-ui",
      flow: "balance_topup",
    },
  };

  payload.Token = buildTBankToken(payload, password);

  let response: Response;
  try {
    response = await fetch(getTBankInitUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    await saveTBankInitResponse(orderId, {
      status: "init_request_error",
      initPayload: { error: "network" },
    });
    return NextResponse.json({ ok: false, error: "Не удалось связаться с Т-Банком" }, { status: 502 });
  }

  let initResult: InitResponse;
  try {
    initResult = (await response.json()) as InitResponse;
  } catch {
    await saveTBankInitResponse(orderId, {
      status: "init_invalid_response",
      initPayload: { error: "invalid_json", status: response.status },
    });
    return NextResponse.json({ ok: false, error: "Т-Банк вернул некорректный ответ" }, { status: 502 });
  }

  const paymentId = toNumberOrNull(initResult.PaymentId);
  const paymentUrl = typeof initResult.PaymentURL === "string" && initResult.PaymentURL.trim() ? initResult.PaymentURL : null;
  const status = typeof initResult.Status === "string" && initResult.Status.trim() ? initResult.Status : "init_failed";

  await saveTBankInitResponse(orderId, {
    status,
    paymentId,
    paymentUrl,
    initPayload: initResult,
  });

  if (!initResult.Success || !paymentUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: initResult.Message || initResult.Details || "Т-Банк не смог инициализировать платёж",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    orderId,
    paymentId,
    paymentUrl,
  });
}
