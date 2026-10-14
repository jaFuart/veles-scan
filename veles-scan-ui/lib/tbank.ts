import { createHash } from "node:crypto";

const TBANK_API_BASE = "https://securepay.tinkoff.ru/v2";

function isTokenValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

export function buildTBankToken(payload: Record<string, unknown>, password: string): string {
  const values = new Map<string, string>();

  Object.entries(payload).forEach(([key, value]) => {
    if (key === "Token") {
      return;
    }
    if (!isTokenValue(value)) {
      return;
    }
    values.set(key, String(value));
  });

  values.set("Password", password);

  const digestSource = Array.from(values.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
    .join("");

  return createHash("sha256").update(digestSource).digest("hex");
}

export function verifyTBankToken(payload: Record<string, unknown>, password: string): boolean {
  const tokenRaw = payload.Token;
  if (typeof tokenRaw !== "string" || !tokenRaw.trim()) {
    return false;
  }

  const expected = buildTBankToken(payload, password);
  return tokenRaw === expected;
}

export function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const normalized = Math.trunc(parsed);
      return normalized > 0 ? normalized : null;
    }
  }
  return null;
}

export function getTBankInitUrl(): string {
  return `${TBANK_API_BASE}/Init`;
}

export function getTBankCancelUrl(): string {
  return `${TBANK_API_BASE}/Cancel`;
}
