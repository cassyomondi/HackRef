import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { getIronSession, type CookieJar } from "iron-session";
import {
  authConfig,
  SESSION_SECONDS,
  type SessionData,
} from "../../src/lib/auth-config";
import { verifyCsrf } from "../../src/lib/csrf";
import { hashPassword, verifyPassword } from "../../src/lib/password";
import { testDatabaseUrl } from "../../src/lib/test-database";

test("passwords use salted scrypt; wrong passwords and missing users fail", async () => {
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt-v1\$[a-f0-9]{64}\$[a-f0-9]{128}$/);
  assert.ok(await verifyPassword(password, hash));
  assert.equal(await verifyPassword("incorrect password", hash), false);
  assert.equal(await verifyPassword(password, null), false);
  assert.notEqual(await hashPassword(password), hash);
  await assert.rejects(hashPassword("too short"));
  await assert.rejects(hashPassword("💻".repeat(70)));
});

test("production sessions require HTTPS and secure host-only HTTP-only cookies", () => {
  const env = {
    SESSION_PASSWORD: randomBytes(48).toString("hex"),
    APP_ORIGIN: "https://hackref.example",
    NODE_ENV: "production",
  };
  const { options } = authConfig(env);
  assert.equal(options.cookieName, "__Host-hackref");
  assert.deepEqual(options.cookieOptions, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  assert.throws(() =>
    authConfig({ ...env, APP_ORIGIN: "http://localhost:3000" }),
  );
  assert.throws(() =>
    authConfig({ ...env, APP_ORIGIN: "https://hackref.example/" }),
  );
  assert.throws(() => authConfig({ ...env, SESSION_PASSWORD: "short" }));
  assert.throws(() =>
    authConfig({
      ...env,
      NODE_ENV: "development",
      APP_ORIGIN: "http://remote.example",
    }),
  );
  assert.throws(() =>
    authConfig({
      ...env,
      NODE_ENV: "development",
      APP_ORIGIN: "ftp://localhost",
    }),
  );
  assert.equal(
    authConfig({
      ...env,
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
    }).options.cookieOptions?.secure,
    false,
  );
});

test("iron-session encrypts and authenticates session data and clears cookies on logout", async () => {
  const { options } = authConfig({
    SESSION_PASSWORD: randomBytes(48).toString("hex"),
    APP_ORIGIN: "https://hackref.example",
    NODE_ENV: "production",
  });
  const values = new Map<string, string>();
  const jar: CookieJar = {
    read: (name) => values.get(name),
    write: (name, value) => {
      values.set(name, value);
    },
  };
  const session = await getIronSession<SessionData>(jar, options);
  session.token = randomBytes(32).toString("hex");
  session.csrf = randomBytes(32).toString("hex");
  await session.save();
  const seal = values.get(options.cookieName)!;
  assert.ok(!seal.includes(session.token));
  assert.equal(
    (await getIronSession<SessionData>(jar, options)).token,
    session.token,
  );
  values.set(options.cookieName, seal.slice(0, -5) + "XXXXX");
  assert.equal(
    (await getIronSession<SessionData>(jar, options)).token,
    undefined,
  );
  session.destroy();
  assert.equal(values.get(options.cookieName), "");
});

test("CSRF requires both the session nonce and exact configured origin", () => {
  const nonce = randomBytes(32).toString("hex");
  const headers = new Headers({
    origin: "https://hackref.example",
    "x-csrf-token": nonce,
  });
  assert.doesNotThrow(() =>
    verifyCsrf(headers, nonce, "https://hackref.example"),
  );
  const invalidHeaders: Record<string, string>[] = [
    { origin: "https://evil.example" },
    { origin: "null" },
    { "x-csrf-token": "" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const changes of invalidHeaders) {
    assert.throws(() =>
      verifyCsrf(
        new Headers({ ...Object.fromEntries(headers), ...changes }),
        nonce,
        "https://hackref.example",
      ),
    );
  }
  headers.delete("origin");
  assert.throws(() => verifyCsrf(headers, nonce, "https://hackref.example"));
});

test("database tests refuse the development database, remote hosts and missing configuration", () => {
  const DATABASE_URL = "postgres://localhost/hackref";
  assert.throws(() => testDatabaseUrl({ DATABASE_URL }));
  for (const TEST_DATABASE_URL of [
    DATABASE_URL,
    "postgres://localhost/hackref_dev",
    "postgres://remote.example/hackref_test",
  ])
    assert.throws(() => testDatabaseUrl({ DATABASE_URL, TEST_DATABASE_URL }));
  assert.throws(() =>
    testDatabaseUrl({
      DATABASE_URL: "postgres://127.0.0.1/hackref_test",
      TEST_DATABASE_URL: "postgres://localhost/hackref_test",
    }),
  );
  assert.equal(
    testDatabaseUrl({
      DATABASE_URL,
      TEST_DATABASE_URL: "postgres://localhost/hackref_test",
    }),
    "postgres://localhost/hackref_test",
  );
});
