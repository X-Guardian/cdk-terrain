/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

// Build the cdktn language packages via jsii-pacmak.
//
// Why this script exists:
//   cdktn ships its runtime deps (json-stable-stringify, semver, yazl) inside
//   the published tarball so JSII pacmak can embed them in the
//   Python/Java/Go/.NET targets — the embedded JS needs them at runtime in
//   user environments where there is no `npm install`.
//
//   Under pnpm's default isolated layout, those deps inside packages/cdktn/
//   node_modules are symlinks back into ../../node_modules/.pnpm/<dep>/. When
//   `npm pack` (called by jsii-pacmak) walks the symlinks, it produces
//   tarball entries with `..`-escape paths that most tar extractors discard,
//   leaving the bundled deps' transitives missing in the published tarballs.
//
//   This script sidesteps the issue by copying cdktn's source into a staging
//   directory and running `npm install --omit=dev` there. npm produces a
//   regular nested node_modules layout (no symlinks), which jsii-pacmak +
//   `npm pack` can bundle correctly. Outputs are copied back to packages/cdktn
//   /dist/.
//
//   bundledDependencies is also derived here from the package.json's
//   `dependencies` and written into the staging package.json. This avoids
//   maintaining the same list in two places (every runtime dep MUST be
//   bundled because language users have no `npm install` step).

import { execFileSync } from "node:child_process";
import {
  rmSync,
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, "..");
const stagingDir = join(packageDir, ".pack-staging");
const distOutDir = join(packageDir, "dist");

/**
 * Run a command synchronously, inheriting stdio and logging the invocation.
 * Throws on non-zero exit.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptionsWithBufferEncoding} [opts]
 */
function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    stdio: "inherit",
    cwd: packageDir,
    ...opts,
  });
}

/**
 * Use `npm pack --dry-run --json` to discover the file list npm would publish
 * and return it as relative paths from `packageDir`. Drops any `..`-escape
 * paths that come from npm following pnpm's node_modules symlinks — those are
 * the broken entries the staging copy will replace with a clean `npm install`.
 *
 * @returns {string[]} relative paths from packageDir
 */
function resolveSourceFiles() {
  console.log("Resolving cdktn's file list via `npm pack --dry-run`...");
  const packJson = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: packageDir,
  }).toString();
  const packInfo = JSON.parse(packJson);
  const files = packInfo[0].files
    .map((f) => f.path)
    .filter((p) => !p.includes(".."));
  console.log(`  ${files.length} source files to copy.`);
  return files;
}

/**
 * Recreate the staging directory empty.
 */
function prepareStagingDir() {
  console.log(`Preparing staging dir at ${stagingDir}...`);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
}

/**
 * Copy the resolved source files into the staging directory, preserving
 * relative paths.
 *
 * @param {string[]} sourceFiles relative paths from packageDir
 */
function copySourceFiles(sourceFiles) {
  for (const relPath of sourceFiles) {
    const src = join(packageDir, relPath);
    const dst = join(stagingDir, relPath);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
}

/**
 * Derive `bundledDependencies` from the staging package.json's runtime
 * `dependencies` and write the updated package.json back. Single source of
 * truth: every runtime dep is bundled (the JSII bindings have no other way to
 * acquire them at runtime). The checked-in cdktn/package.json deliberately
 * omits `bundledDependencies`; jsii-pacmak / npm pack only see the array form
 * via this staging copy.
 */
function deriveBundledDependencies() {
  const stagingPkgPath = join(stagingDir, "package.json");
  const stagingPkg = JSON.parse(readFileSync(stagingPkgPath, "utf8"));
  stagingPkg.bundledDependencies = Object.keys(stagingPkg.dependencies ?? {});
  console.log(
    `  bundledDependencies derived: [${stagingPkg.bundledDependencies.join(", ")}]`,
  );
  writeFileSync(stagingPkgPath, JSON.stringify(stagingPkg, null, 2) + "\n");
}

/**
 * Install runtime dependencies into the staging directory using npm. Produces
 * a flat/nested node_modules layout (no pnpm symlinks) suitable for npm pack.
 *
 * Flags:
 *   --omit=dev:           skip devDependencies (jest, jsii, typescript, ...).
 *   --omit=optional:      skip optional deps.
 *   --no-package-lock:    don't pollute staging with a fresh lockfile.
 *   --prefer-offline:     use the local npm cache before the network.
 *   --ignore-scripts:     don't run install scripts of bundled deps; bundling
 *                         needs the tree on disk only.
 */
function installRuntimeDeps() {
  console.log("Installing runtime deps into staging via npm...");
  run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--omit=optional",
      "--no-package-lock",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    { cwd: stagingDir },
  );
}

/**
 * Run jsii-pacmak from the staging directory. Resolves the bin via
 * `require.resolve` so the script works under pnpm's isolated node_modules
 * layout, where `node_modules/.bin/jsii-pacmak` isn't a flat shim.
 *
 * @param {string[]} targets jsii-pacmak `--targets` values; empty = all.
 */
function runJsiiPacmak(targets) {
  console.log("Running jsii-pacmak from staging...");
  const localRequire = createRequire(import.meta.url);
  const jsiiPacmakBin = localRequire.resolve("jsii-pacmak/bin/jsii-pacmak");
  const args = targets.length > 0 ? ["--targets", ...targets] : [];
  run("node", [jsiiPacmakBin, ...args], { cwd: stagingDir });
}

/**
 * Run go-copyright-header.sh against the staging output. Operates on dist/go/
 * so needs to run from where dist/ landed (the staging dir).
 */
function runGoCopyrightHeader() {
  const script = join(stagingDir, "go-copyright-header.sh");
  if (!existsSync(script)) return;
  console.log("Running go-copyright-header.sh from staging...");
  run("bash", ["./go-copyright-header.sh"], { cwd: stagingDir });
}

/**
 * Move the produced dist/ from staging back to the package's dist/.
 * Replaces any prior content.
 */
function moveDistOut() {
  const stagingDist = join(stagingDir, "dist");
  if (!existsSync(stagingDist)) {
    console.error(`No dist/ produced in staging at ${stagingDist}`);
    process.exit(1);
  }
  console.log(`Moving staging dist/ to ${distOutDir}...`);
  rmSync(distOutDir, { recursive: true, force: true });
  cpSync(stagingDist, distOutDir, { recursive: true });
}

const targets = process.argv.slice(2);
const sourceFiles = resolveSourceFiles();
prepareStagingDir();
copySourceFiles(sourceFiles);
deriveBundledDependencies();
installRuntimeDeps();
runJsiiPacmak(targets);
runGoCopyrightHeader();
moveDistOut();
console.log("Done.");
