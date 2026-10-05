import { building } from "$app/env";
import { redirect } from "@sveltejs/kit";
import { type Handle, sequence } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";

import { auth } from "#lib/server/auth.ts";
import {
  pathAfterSignIn,
  SIGN_IN_PATH,
  signInPath,
} from "#lib/server/sign-in-redirect.ts";

// Better Auth's own endpoints (/api/auth/*) are answered here, so they skip
// the session lookup and sign-in guard below. Other requests pass through.
const betterAuthEndpoints: Handle = ({ event, resolve }) =>
  svelteKitHandler({ event, resolve, auth, building });

// Every other request: pages, form actions, endpoints, and the data requests
// behind client-side navigation. Guarding here (not in a layout's `load`) also
// covers form actions and +server.ts endpoints, which layout loads never run for.
const signInGuard: Handle = async ({ event, resolve }) => {
  // HTML and navigation data include the current user's identity/list.
  // Kit throws if a header is set twice, so a future cacheable route must be
  // skipped here rather than setting its own cache-control in `load`.
  event.setHeaders({ "cache-control": "private, no-store" });
  // `locals` is per request, so concurrent requests on one instance never see
  // each other's user. Reads the session cookie and looks the session up.
  const result = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = result?.user ?? null;
  event.locals.session = result?.session ?? null;

  // The sign-in page is the only page open to signed-out visitors, and the
  // only one closed to signed-in ones. These two redirects are the whole
  // sign-in routing: after signing in or out, pages just re-run their loads,
  // and the request lands here.
  const onSignInPage = event.url.pathname === SIGN_IN_PATH;
  if (event.locals.user === null && !onSignInPage) {
    redirect(303, signInPath(event.url));
  }
  if (event.locals.user !== null && onSignInPage) {
    redirect(303, pathAfterSignIn(event.url));
  }

  return resolve(event);
};

// Runs in order: calling `resolve` in one hands the request to the next.
export const handle = sequence(betterAuthEndpoints, signInGuard);
