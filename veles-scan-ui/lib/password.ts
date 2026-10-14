import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  if (storedHash.startsWith("plain:")) {
    return storedHash.slice("plain:".length) === password;
  }

  if (!storedHash.startsWith("scrypt:")) {
    return false;
  }

  const [scheme, salt, hashHex] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !hashHex) {
    return false;
  }

  const calculated = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hashHex, "hex");

  if (calculated.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(calculated, expected);
}
