import { describe, expect, it } from "vitest";

import { pathAfterSignIn, signInPath } from "./sign-in-redirect.ts";

const ORIGIN = "https://vunu.test";

describe("signInPath", () => {
  it("remembers the requested page, including its query", () => {
    expect(signInPath(new URL(`${ORIGIN}/seen?page=2`))).toBe(
      "/sign-in?redirectTo=%2Fseen%3Fpage%3D2"
    );
  });

  it("leaves out the home page", () => {
    expect(signInPath(new URL(`${ORIGIN}/`))).toBe("/sign-in");
  });

  it("keeps page filters but drops a POST's named action", () => {
    expect(
      signInPath(new URL(`${ORIGIN}/seen?scope=all&title=Inception&/add`))
    ).toBe("/sign-in?redirectTo=%2Fseen%3Fscope%3Dall%26title%3DInception");
  });
});

describe("pathAfterSignIn", () => {
  function after(redirectTo: string | null): string {
    const url = new URL(`${ORIGIN}/sign-in`);
    if (redirectTo !== null) url.searchParams.set("redirectTo", redirectTo);
    return pathAfterSignIn(url);
  }

  it("returns to the requested page", () => {
    expect(after("/seen?page=2")).toBe("/seen?page=2");
  });

  it("goes home without a redirectTo", () => {
    expect(after(null)).toBe("/");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    // Browsers strip tabs and newlines from URLs, leaving "//evil.com".
    "/\t/evil.com",
    "https://evil.com/seen",
    "javascript:alert(1)",
  ])("refuses to leave the site (%j)", (redirectTo) => {
    expect(after(redirectTo)).toBe("/");
  });

  it("never returns to the sign-in page", () => {
    expect(after("/sign-in?redirectTo=%2Fsign-in")).toBe("/");
  });
});
