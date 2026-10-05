import { getRequestEvent } from "$app/server";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { z } from "zod";

import type { Db } from "#lib/server/db/client.ts";
import {
  consumeSignInCodeRequest,
  WINDOW_MINUTES,
} from "#lib/server/sign-in-code-limit.ts";

// The part of a send-code request our per-email limit needs. Normalized the
// way Better Auth does it (lowercase, then validate), so the limit counts
// exactly the address the code is sent to. Better Auth validates the rest.
const signInCodeRequestSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .pipe(z.email()),
  // Only sign-in codes are emailed (see `sendVerificationOTP` below).
  type: z.literal("sign-in"),
});

// Created once per instance (module level), like the database pool. It holds
// configuration only; per-request data arrives through each call's headers.
export function createAuth({
  db,
  secret,
  sendCode,
}: {
  db: Db;
  secret: string;
  sendCode: (email: string, code: string) => Promise<void>;
}) {
  return betterAuth({
    secret,
    appName: "Vunu",
    // Better Auth 1.7.7 disables origin checks under NODE_ENV=test by default.
    // Keep the real protection enabled in every environment, including tests.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    // Better Auth builds URLs and checks request origins from the request's host,
    // but only for hosts on this list. Explicit hosts, not "*.vercel.app": that
    // would also trust every other Vercel project.
    baseURL: {
      allowedHosts: [
        "localhost:5173", // vite dev
        "localhost:4173", // vite preview (e2e tests)
        "vunu.app",
        "www.vunu.app",
      ],
    },
    // `usePlural` maps Better Auth's models (user, session…) to our plural tables.
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      // node-postgres supports interactive transactions. Enable the adapter's
      // multi-statement transaction boundary, which defaults to false in 1.7.7.
      transaction: true,
    }),
    rateLimit: {
      enabled: true,
      // In memory, every serverless instance would keep its own counts.
      storage: "database",
      // Per IP, and a room of people on one Wi-Fi shares an IP, so these leave
      // room for a group signing in together. The strict limit is per email
      // address (`hooks` below).
      customRules: {
        // Each send is an email; also caps how fast one IP can use up Resend's
        // free tier (100 a day).
        "/email-otp/send-verification-otp": { window: 600, max: 10 },
        // Default is 3 per 10 seconds. Guessing is already stopped by each
        // code's 3-attempt limit, so this only needs to stop hammering.
        "/sign-in/email-otp": { window: 60, max: 10 },
      },
    },
    hooks: {
      // Runs after the IP limit but before the endpoint, so a refused request
      // never replaces the pending code.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/email-otp/send-verification-otp") return;
        const body = signInCodeRequestSchema.safeParse(ctx.body);
        // Reject unsupported OTP purposes before the plugin stores a code.
        if (!body.success) {
          throw new APIError("BAD_REQUEST", {
            message: "Provide a valid email and request a sign-in code.",
          });
        }
        if (!(await consumeSignInCodeRequest(db, body.data.email))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many codes for this email. Try again in ${String(WINDOW_MINUTES)} minutes.`,
          });
        }
      }),
    },
    // Sign-in by code is the only method. Close the plugin's password and
    // email-change endpoints so they can't be used to attach other credentials.
    disabledPaths: [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    plugins: [
      emailOTP({
        // Encryption keeps active codes out of DB dumps while allowing reuse.
        // Hashing would force rotation on every resend in Better Auth 1.7.7.
        storeOTP: "encrypted",
        // Asking again re-sends the pending code (with a fresh 5 minutes) instead
        // of replacing it, so whichever email arrives first has a working code.
        resendStrategy: "reuse",
        // Better Auth runs this without passing errors back: a failed send is
        // logged, and the request still reports success.
        async sendVerificationOTP({ email, otp, type }) {
          // Codes are only for signing in. The same endpoint also issues
          // email-verification and password-reset codes, which we never send.
          if (type !== "sign-in") return;
          await sendCode(email, otp);
        },
      }),
      // Lets Better Auth set cookies when called from server code (e.g. a
      // refreshed session expiry during `getSession` in hooks.server.ts).
      // Must be the last plugin.
      sveltekitCookies(getRequestEvent),
    ],
  });
}
