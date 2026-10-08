import {
  BETTER_AUTH_SECRET,
  VERCEL_BRANCH_URL,
  VERCEL_ENV,
  VERCEL_URL,
} from "$app/env/private";

import { createAuth } from "#lib/server/create-auth.ts";
import { db } from "#lib/server/db/index.ts";
import { sendSignInCode } from "#lib/server/email.ts";

// Runtime wiring stays separate from the auth configuration, so tests can
// exercise the real HTTP handler with a disposable DB and a mock mail sender.
export const auth = createAuth({
  db,
  secret: BETTER_AUTH_SECRET,
  sendCode: sendSignInCode,
  // Previews live at generated hostnames. Trust exactly this deployment's
  // (its own URL and its Git branch's URL), never all of *.vercel.app.
  previewHosts:
    VERCEL_ENV === "preview"
      ? [VERCEL_URL, VERCEL_BRANCH_URL].filter((host) => host !== undefined)
      : [],
});

export type AuthSession = typeof auth.$Infer.Session;
