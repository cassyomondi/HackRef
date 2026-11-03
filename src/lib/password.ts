import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string) {
  if (password.length < 15 || Buffer.byteLength(password) > 256) {
    throw new Error(
      "Use a password of at least 15 characters and at most 256 UTF-8 bytes.",
    );
  }
  const salt = randomBytes(32).toString("hex");
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split("$");
  const valid =
    parts?.length === 3 &&
    parts[0] === "scrypt-v1" &&
    /^[a-f0-9]{64}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  // Missing users still perform the same expensive work; no username oracle.
  const key = await derive(password, valid ? parts[1] : "0".repeat(64));
  return !!valid && timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}
