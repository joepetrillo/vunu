import { randomInt } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAuth } from "#lib/server/create-auth.ts";
import {
  sessions,
  signInCodeLimits,
  users,
  verifications,
} from "#lib/server/db/schema.ts";
import { MAX_CODES_PER_EMAIL } from "#lib/server/sign-in-code-limit.ts";
import { connectTestDb } from "#lib/server/testing/db.ts";
import { TEST_AUTH_SECRET } from "#lib/server/testing/environment.ts";
import { deleteAccount, readSignInCode } from "#lib/server/testing/sign-in.ts";

const { pool, db } = connectTestDb();
const deliveries = new Map<string, string>();
const emails = new Set<string>();
const auth = createAuth({
  db,
  secret: TEST_AUTH_SECRET,
  sendCode: (email, code) => {
    deliveries.set(email, code);
    return Promise.resolve();
  },
});

let ip: string;
let email: string;
beforeEach(() => {
  ip = `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`;
  email = `${crypto.randomUUID()}@example.test`;
  emails.add(email);
});

afterAll(async () => {
  for (const address of emails) await deleteAccount(db, address);
  await pool.end();
});

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return auth.handler(
    new Request(`http://localhost:4173/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...headers,
      },
      body: JSON.stringify(body),
    })
  );
}

function sendCode(address = email) {
  return post("/email-otp/send-verification-otp", {
    email: address,
    type: "sign-in",
  });
}

function signIn(code: string) {
  return post("/sign-in/email-otp", { email, otp: code });
}

describe("email-code HTTP authentication", () => {
  it("normalizes addresses, encrypts codes, and reuses an unexpired code", async () => {
    expect((await sendCode(email.toUpperCase())).status).toBe(200);
    const code = await readSignInCode(db, email);
    const stored = await db.query.verifications.findFirst({
      where: { identifier: `sign-in-otp-${email}` },
    });
    expect(deliveries.get(email)).toBe(code);
    expect(stored?.value).not.toBe(`${code}:0`);
    expect(stored?.value.split(":")[0]?.length).toBeGreaterThan(6);

    expect((await sendCode()).status).toBe(200);
    expect(await readSignInCode(db, email)).toBe(code);
    expect(deliveries.get(email)).toBe(code);
  });

  it("rejects unsupported OTP purposes before storing or sending anything", async () => {
    for (const type of [
      "email-verification",
      "forget-password",
      "change-email",
    ]) {
      expect(
        (await post("/email-otp/send-verification-otp", { email, type })).status
      ).toBe(400);
    }
    expect(deliveries.has(email)).toBe(false);
    expect(
      await db.$count(
        verifications,
        eq(verifications.identifier, `email-verification-otp-${email}`)
      )
    ).toBe(0);
    expect(
      await db.$count(signInCodeLimits, eq(signInCodeLimits.email, email))
    ).toBe(0);
  });

  it.each([
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ])("doesn't expose the unused operation %s", async (path) => {
    expect(
      (await post(path, { email, type: "sign-in", otp: "123456" })).status
    ).toBe(404);
  });

  it("accepts a code only once, including two simultaneous HTTP requests", async () => {
    expect((await sendCode()).status).toBe(200);
    const code = await readSignInCode(db, email);
    const responses = await Promise.all([signIn(code), signIn(code)]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect((await signIn(code)).status).toBe(400);

    const user = await db.query.users.findFirst({ where: { email } });
    expect(user?.emailVerified).toBe(true);
    expect(
      await db.$count(sessions, eq(sessions.userId, user?.id ?? "missing"))
    ).toBe(1);
  });

  it("rejects expired codes and allows a fresh request", async () => {
    expect((await sendCode()).status).toBe(200);
    const code = await readSignInCode(db, email);
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, `sign-in-otp-${email}`));
    expect((await signIn(code)).status).toBe(400);
    expect(await db.$count(users, eq(users.email, email))).toBe(0);

    expect((await sendCode()).status).toBe(200);
    expect((await signIn(await readSignInCode(db, email))).status).toBe(200);
  });

  it("exhausts the three-guess budget and permits recovery with a new code", async () => {
    expect((await sendCode()).status).toBe(200);
    const code = await readSignInCode(db, email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await signIn(wrong)).status).toBe(400);
    }
    expect((await signIn(code)).status).toBe(403);
    expect(await db.$count(users, eq(users.email, email))).toBe(0);

    expect((await sendCode()).status).toBe(200);
    expect((await signIn(await readSignInCode(db, email))).status).toBe(200);
  });

  it("rejects a fourth email request without replacing the pending code", async () => {
    for (let attempt = 0; attempt < MAX_CODES_PER_EMAIL; attempt++) {
      expect((await sendCode()).status).toBe(200);
    }
    const code = await readSignInCode(db, email);
    expect((await sendCode(email.toUpperCase())).status).toBe(429);
    expect(await readSignInCode(db, email)).toBe(code);
  });

  it("enforces the database-backed IP limit across separate auth instances", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const address = `${crypto.randomUUID()}@example.test`;
      emails.add(address);
      expect((await sendCode(address)).status).toBe(200);
    }
    const otherInstance = createAuth({
      db,
      secret: TEST_AUTH_SECRET,
      sendCode: () => Promise.resolve(),
    });
    const response = await otherInstance.handler(
      new Request(
        "http://localhost:4173/api/auth/email-otp/send-verification-otp",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ email, type: "sign-in" }),
        }
      )
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(deliveries.has(email)).toBe(false);
  });

  it.each(["vunu.app", "www.vunu.app"])(
    "accepts a sign-in code request from https://%s",
    async (host) => {
      const origin = `https://${host}`;
      const response = await auth.handler(
        new Request(`${origin}/api/auth/email-otp/send-verification-otp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": ip,
            origin,
            cookie: "better-auth.session_token=invalid",
          },
          body: JSON.stringify({ email, type: "sign-in" }),
        })
      );
      expect(response.status).toBe(200);
      expect(deliveries.get(email)).toBe(await readSignInCode(db, email));
    }
  );

  it("trusts a Preview deployment's own hosts and no other", async () => {
    const preview = "vunu-git-stage-5-groups-joes-projects-dab9d62e.vercel.app";
    const previewAuth = createAuth({
      db,
      secret: TEST_AUTH_SECRET,
      sendCode: () => Promise.resolve(),
      previewHosts: [preview],
    });
    const session = await previewAuth.handler(
      new Request(`https://${preview}/api/auth/get-session`)
    );
    expect(session.status).toBe(200);
    await expect(
      previewAuth.handler(
        new Request(
          "https://vunu-git-other-joes-projects-dab9d62e.vercel.app/api/auth/get-session"
        )
      )
    ).rejects.toThrow(/allowed hosts list/);
    // The default (Production, local) never trusts a preview host.
    await expect(
      auth.handler(new Request(`https://${preview}/api/auth/get-session`))
    ).rejects.toThrow(/allowed hosts list/);
  });

  it("rejects an untrusted origin with a cookie and rejects unknown hosts", async () => {
    const rejected = await post(
      "/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      {
        origin: "https://evil.example",
        cookie: "better-auth.session_token=invalid",
      }
    );
    expect(rejected.status).toBe(403);
    expect(deliveries.has(email)).toBe(false);

    for (const host of [
      "evil.example",
      "other-project.vercel.app",
      "unseen-sooty-ten.vercel.app",
    ]) {
      await expect(
        auth.handler(new Request(`https://${host}/api/auth/get-session`))
      ).rejects.toThrow(/allowed hosts list/);
    }
  });
});
