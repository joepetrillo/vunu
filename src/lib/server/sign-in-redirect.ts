// Where hooks.server.ts sends people around sign-in.

export const SIGN_IN_PATH = "/sign-in";

/** The sign-in URL for a signed-out visitor, remembering where they were going. */
export function signInPath(requested: URL): string {
  const params = new URLSearchParams(requested.search);
  // An expired-session POST should return to the page, not carry its reserved
  // named action into the next form submission. Other filters stay intact.
  for (const name of [...params.keys()]) {
    if (name.startsWith("/")) params.delete(name);
  }
  const search = params.toString();
  const target = requested.pathname + (search === "" ? "" : `?${search}`);
  if (target === "/") return SIGN_IN_PATH;
  const query = new URLSearchParams({ redirectTo: target }).toString();
  return `${SIGN_IN_PATH}?${query}`;
}

/**
 * Where to send someone who just signed in: the `redirectTo` path from the
 * sign-in URL, or home. Anyone can craft that parameter, so it's parsed as a
 * URL against our own origin instead of checked as a string. Values like
 * "//evil.com" or "/\t/evil.com" look like paths, but browsers resolve them to
 * another site (an "open redirect").
 */
export function pathAfterSignIn(signInUrl: URL): string {
  const value = signInUrl.searchParams.get("redirectTo");
  const target = value === null ? null : URL.parse(value, signInUrl);
  if (
    target?.origin !== signInUrl.origin ||
    // Redirecting to the sign-in page itself would loop.
    target.pathname === SIGN_IN_PATH
  ) {
    return "/";
  }
  return target.pathname + target.search;
}
