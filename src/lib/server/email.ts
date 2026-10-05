import { RESEND_API_KEY, VERCEL_ENV } from "$app/env/private";
import { Resend } from "resend";

// vunu.app is verified in Resend, so sign-in codes can reach group members.
const FROM = "Vunu <hello@vunu.app>";

// Created once per instance, like the database pool. Undefined locally, where
// codes go to the terminal instead.
const resend =
  RESEND_API_KEY === undefined ? undefined : new Resend(RESEND_API_KEY);

// Hosted previews have real users too. Fail when server modules initialize,
// before Better Auth can swallow a send error or expose codes in hosted logs.
if (
  resend === undefined &&
  (VERCEL_ENV === "production" || VERCEL_ENV === "preview")
) {
  throw new Error(
    "RESEND_API_KEY is required on hosted Preview and Production deployments."
  );
}

export async function sendSignInCode(to: string, code: string): Promise<void> {
  if (resend === undefined) {
    console.info(`[email] Sign-in code for ${to}: ${code}`);
    return;
  }

  // Resend reports failures in `error` instead of throwing.
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `${code} is your Vunu sign-in code`,
    text: `Your Vunu sign-in code is ${code}. It expires in 5 minutes.\n\nIf you didn't try to sign in, you can ignore this email.`,
  });
  if (error !== null) {
    // Better Auth logs this error. Provider messages can contain recipients;
    // retain the typed error category without leaking email/code content.
    throw new Error(`Resend failed to send the sign-in code (${error.name}).`);
  }
}
