// Production's Neon compute endpoint (branch `production`). Not a secret: the
// password in the connection string is. If Production's endpoint is ever
// replaced, update this ID (Neon console → Branches → production → Computes).
export const PRODUCTION_ENDPOINT_ID = "ep-aged-sun-b81mzqrl";

/**
 * Whether a connection string points at Production's endpoint, pooled
 * (`ep-…-pooler.…`) or direct (`ep-….…`).
 */
export function isProductionDatabase(connectionString: string): boolean {
  const label = new URL(connectionString).hostname.split(".")[0] ?? "";
  return (
    label === PRODUCTION_ENDPOINT_ID ||
    label.startsWith(`${PRODUCTION_ENDPOINT_ID}-`)
  );
}

/**
 * Stops a Preview deployment from using Production's database. Preview
 * deploys migrate before building and serve real requests, so a Preview
 * environment left pointing at Production (say, preview branching switched
 * off in the Neon integration) would change Production. This turns that
 * misconfiguration into a failed preview instead.
 */
export function assertPreviewIsolated(
  vercelEnv: string | undefined,
  connectionString: string
): void {
  if (vercelEnv === "preview" && isProductionDatabase(connectionString)) {
    throw new Error(
      "This Preview deployment is configured with Production's database. Turn on Neon preview branching for Preview (docs/PROJECT_SPEC.md, section 5b)."
    );
  }
}
