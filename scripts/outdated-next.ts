/**
 * Checks our pinned pre-release packages (currently Drizzle `1.0.0-rc.4`)
 * against npm. `bun outdated` can't do this: it compares against each package's
 * `latest` tag, which still points at the old stable version while a new major
 * is in pre-release.
 *
 * Run: `bun run outdated:next`
 */
import { readFile } from "node:fs/promises";

interface Version {
  core: number[];
  pre: (number | string)[];
}

function parseVersion(version: string): Version {
  const [core = "", pre] = version.split("-", 2);
  return {
    core: core.split(".").map(Number),
    pre: pre === undefined ? [] : pre.split(".").map(toIdentifier),
  };
}

function toIdentifier(part: string): number | string {
  return /^\d+$/.test(part) ? Number(part) : part;
}

/** Semver ordering: negative if a < b, 0 if equal, positive if a > b. */
function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A release (no pre-release part) ranks above any of its pre-releases.
  if (va.pre.length === 0 || vb.pre.length === 0) {
    return vb.pre.length - va.pre.length;
  }
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    // Numeric identifiers rank below text ones, per semver.
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** npm's dist-tags map tag names (latest, next, rc…) to versions. */
async function fetchDistTags(name: string): Promise<Record<string, string>> {
  const response = await fetch(
    `https://registry.npmjs.org/-/package/${name}/dist-tags`
  );
  if (!response.ok) {
    throw new Error(`npm registry returned ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("unexpected response shape");
  return Object.fromEntries(
    Object.entries(body).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function majorOf(version: string): number {
  return parseVersion(version).core[0] ?? 0;
}

async function main(): Promise<void> {
  const pkg: unknown = JSON.parse(await readFile("package.json", "utf8"));
  // Both lists: drizzle-orm is a runtime dependency, drizzle-kit a dev one.
  const deps = {
    ...(isRecord(pkg) && isRecord(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isRecord(pkg) && isRecord(pkg.devDependencies)
      ? pkg.devDependencies
      : {}),
  };

  // Anything pinned to an exact pre-release version, like "1.0.0-rc.4".
  const pinned = Object.entries(deps).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && /^\d+\.\d+\.\d+-/.test(entry[1])
  );

  let actionNeeded = false;
  for (const [name, installed] of pinned) {
    const tags = await fetchDistTags(name);
    const latest = tags.latest;

    // Stable for this major is out: time to leave the pre-release channel.
    if (latest !== undefined && majorOf(latest) >= majorOf(installed)) {
      actionNeeded = true;
      console.log(
        `⬆ ${name}: stable ${latest} is out (you have ${installed}). Switch to "^${latest}".`
      );
      continue;
    }

    // Newest version published under a tag in the same major (next, rc, beta…).
    // Tags ending in a commit hash (e.g. 1.0.0-rc.5-5935859) are preview builds.
    const candidates = Object.values(tags).filter(
      (version) =>
        majorOf(version) === majorOf(installed) &&
        !/-[0-9a-f]{7}$/.test(version)
    );
    const newest = candidates.reduce(
      (best, version) => (compareVersions(version, best) > 0 ? version : best),
      installed
    );

    if (compareVersions(newest, installed) > 0) {
      actionNeeded = true;
      const tag = Object.entries(tags).find(([, v]) => v === newest)?.[0];
      console.log(
        `⬆ ${name}: ${installed} → ${newest}  (bun add -d --exact ${name}@${tag ?? newest})`
      );
    } else {
      console.log(`✓ ${name}: ${installed} is the newest pre-release`);
    }
  }

  if (actionNeeded) {
    console.log(
      "\nUpgrade paired packages together (kit + adapter-vercel, drizzle-orm + drizzle-kit), then run `bun run verify`."
    );
  }
}

await main();
