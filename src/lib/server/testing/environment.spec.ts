import { afterEach, describe, expect, it, vi } from "vitest";

import { testDatabaseUrl } from "./environment.ts";

const TEST_URL = "postgres://test:test@localhost:55432/disposable";
const APP_URL = "postgres://app:app@database.example/app";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test database selection", () => {
  it("never falls back to DATABASE_URL", () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    vi.stubEnv("DATABASE_URL", APP_URL);

    expect(() => testDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
  });

  it("uses the explicitly supplied test URL", () => {
    vi.stubEnv("TEST_DATABASE_URL", TEST_URL);
    vi.stubEnv("DATABASE_URL", APP_URL);

    expect(testDatabaseUrl()).toBe(TEST_URL);
  });

  it.each(["", "https://example.com/db", "not a URL"])(
    "rejects an invalid test URL (%j)",
    (value) => {
      vi.stubEnv("TEST_DATABASE_URL", value);
      expect(() => testDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
    }
  );
});
