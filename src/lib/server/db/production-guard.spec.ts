import { describe, expect, it } from "vitest";

import {
  assertCatalogSyncTarget,
  assertPreviewIsolated,
  isProductionDatabase,
  PRODUCTION_ENDPOINT_ID,
} from "./production-guard.ts";

const url = (host: string) =>
  `postgresql://user:pw@${host}/neondb?sslmode=require`;

describe("isProductionDatabase", () => {
  it.each([
    `${PRODUCTION_ENDPOINT_ID}.c-14.us-east-1.aws.neon.tech`,
    `${PRODUCTION_ENDPOINT_ID}-pooler.c-14.us-east-1.aws.neon.tech`,
    `${PRODUCTION_ENDPOINT_ID}-v6d-pooler.c-14.us-east-1.aws.neon.tech`,
  ])("recognizes %s", (host) => {
    expect(isProductionDatabase(url(host))).toBe(true);
  });

  it.each([
    "ep-quiet-lake-a1b2c3d4-pooler.c-14.us-east-1.aws.neon.tech",
    // An endpoint whose ID merely starts with the same letters.
    `${PRODUCTION_ENDPOINT_ID}x.c-14.us-east-1.aws.neon.tech`,
    "localhost:5432",
  ])("doesn't flag %s", (host) => {
    expect(isProductionDatabase(url(host))).toBe(false);
  });
});

describe("assertPreviewIsolated", () => {
  const production = url(`${PRODUCTION_ENDPOINT_ID}-pooler.c-14.aws.neon.tech`);

  it("refuses Production's database on Preview only", () => {
    expect(() => {
      assertPreviewIsolated("preview", production);
    }).toThrow(/Production's database/);
    expect(() => {
      assertPreviewIsolated("production", production);
    }).not.toThrow();
    expect(() => {
      assertPreviewIsolated(undefined, production);
    }).not.toThrow();
    expect(() => {
      assertPreviewIsolated("preview", url("ep-other-pooler.aws.neon.tech"));
    }).not.toThrow();
  });
});

describe("assertCatalogSyncTarget", () => {
  const direct = url(`${PRODUCTION_ENDPOINT_ID}.c-14.us-east-1.aws.neon.tech`);
  const development = url(
    "ep-quiet-lake-a1b2c3d4.c-14.us-east-1.aws.neon.tech"
  );

  it("writes to Production only from GitHub Actions", () => {
    expect(() => {
      assertCatalogSyncTarget(direct, undefined);
    }).toThrow(/only writes to Production from its GitHub Actions/);
    expect(() => {
      assertCatalogSyncTarget(direct, "false");
    }).toThrow(/GitHub Actions/);
    expect(() => {
      assertCatalogSyncTarget(direct, "true");
    }).not.toThrow();
    expect(() => {
      assertCatalogSyncTarget(development, undefined);
    }).not.toThrow();
  });

  it.each([
    `${PRODUCTION_ENDPOINT_ID}-pooler.c-14.us-east-1.aws.neon.tech`,
    "ep-quiet-lake-a1b2c3d4-pooler.c-14.us-east-1.aws.neon.tech",
  ])("refuses the pooler (%s), which can't hold the run's lock", (host) => {
    expect(() => {
      assertCatalogSyncTarget(url(host), "true");
    }).toThrow(/direct \(unpooled\)/);
  });
});
