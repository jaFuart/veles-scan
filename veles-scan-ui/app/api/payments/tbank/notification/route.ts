import { NextRequest } from "next/server";
import { finalizeTBankTopupFromNotification } from "@/lib/repositories";
import { parsePositiveInteger, verifyTBankToken } from "@/lib/tbank";

function plainTextOk() {
  return new Response("OK", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: NextRequest) {
  const password = (process.env.TBANK_PASSWORD ?? "").trim();
  if (!password) {
    return new Response("TBANK_PASSWORD is not configured", { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!verifyTBankToken(payload, password)) {
    return new Response("Invalid token", { status: 403 });
  }

  const orderId = toStringOrEmpty(payload.OrderId).trim();
  if (!orderId) {
    return new Response("Missing OrderId", { status: 400 });
  }

  const paymentId = parsePositiveInteger(payload.PaymentId);
  const amountKopecks = parsePositiveInteger(payload.Amount);
  const status = toStringOrEmpty(payload.Status).trim() || "unknown";
  const success = payload.Success === true || payload.Success === "true";

  const result = await finalizeTBankTopupFromNotification({
    orderId,
    status,
    success,
    paymentId,
    amountKopecks,
    rawNotification: payload,
  });

  if (!result.ok && result.reason === "amount_mismatch") {
    return new Response("Amount mismatch", { status: 409 });
  }

  return plainTextOk();
}
