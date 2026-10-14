import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { Viewer } from "@/lib/types";

const SESSION_COOKIE_NAME = "velesscan_session";
const SESSION_TTL_DAYS = 30;

function shouldUseSecureSessionCookie(): boolean {
  if ((process.env.SESSION_COOKIE_SECURE ?? "").toLowerCase() === "true") {
    return true;
  }

  const publicUrl = process.env.APP_PUBLIC_URL ?? "";
  return publicUrl.startsWith("https://");
}

type SessionRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  balance_rub: number;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toViewer(row: SessionRow): Viewer {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? "Пользователь",
    role: row.role,
    balanceRub: row.balance_rub,
  };
}

export async function createUserSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureSessionCookie(),
    expires: expiresAt,
    path: "/",
  });
}

export async function clearUserSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await query("DELETE FROM user_sessions WHERE session_token_hash = $1", [hashToken(token)]);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentViewer(): Promise<Viewer | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const result = await query<SessionRow>(
    `SELECT u.id, u.email, u.full_name, u.role, u.balance_rub
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token_hash = $1
       AND s.expires_at > NOW()
       AND u.is_active = TRUE
     LIMIT 1`,
    [hashToken(token)],
  );

  if (!result.rows[0]) {
    return null;
  }

  return toViewer(result.rows[0]);
}

export async function requireViewer() {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    redirect("/login");
  }
  return viewer;
}

export async function requireAdminViewer() {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") {
    redirect("/projects");
  }
  return viewer;
}
