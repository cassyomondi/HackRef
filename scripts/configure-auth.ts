import { randomBytes } from "node:crypto";
import { readFileSync, appendFileSync, chmodSync } from "node:fs";

// Local-only helper: preserves existing values and never prints the secret.
const path = ".env";
const existing = readFileSync(path, "utf8");
const additions: string[] = [];
if (!/^SESSION_PASSWORD=/m.test(existing))
  additions.push(`SESSION_PASSWORD=${randomBytes(48).toString("base64url")}`);
if (!/^APP_ORIGIN=/m.test(existing))
  additions.push("APP_ORIGIN=http://localhost:3000");
if (additions.length)
  appendFileSync(
    path,
    `\n# PASS 2 local authentication\n${additions.join("\n")}\n`,
    { mode: 0o600 },
  );
chmodSync(path, 0o600);
console.log(
  "Missing local auth settings added to ignored .env. Existing values preserved. Review APP_ORIGIN before starting the app.",
);
