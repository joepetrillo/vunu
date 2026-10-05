import { BETTER_AUTH_SECRET } from "$app/env/private";

import { createAuth } from "#lib/server/create-auth.ts";
import { db } from "#lib/server/db/index.ts";
import { sendSignInCode } from "#lib/server/email.ts";

// Runtime wiring stays separate from the auth configuration, so tests can
// exercise the real HTTP handler with a disposable DB and a mock mail sender.
export const auth = createAuth({
  db,
  secret: BETTER_AUTH_SECRET,
  sendCode: sendSignInCode,
});

export type AuthSession = typeof auth.$Infer.Session;
