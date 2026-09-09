/**
 * Writes dist/version.json with a build-unique version string.
 *
 * The deployed app polls this file: when a new deployment replaces it, the
 * already-open tab notices the version changed and shows "يتوفر تحديث جديد".
 * Vercel exposes VERCEL_GIT_COMMIT_SHA at build time; locally we fall back to
 * a timestamp so every local build is still uniquely identifiable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  `local-${Date.now().toString(36)}`;
const version = sha.length > 12 ? sha.slice(0, 12) : sha;

mkdirSync(resolve("dist"), { recursive: true });
writeFileSync(
  resolve("dist", "version.json"),
  JSON.stringify(
    { version, deployedAt: new Date().toISOString() },
    null,
    2,
  ) + "\n",
);
console.log(`version.json -> ${version}`);
