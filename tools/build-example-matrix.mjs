/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

// Builds the GitHub Actions matrix for the examples workflow.
// Walks examples/ for package.json files named @examples/*, skips ones with
// a truthy "private" field (boolean true or the string "true"), and prints
// a JSON matrix combining the example list with the default terraform
// version and both HCL output modes.
//
// Runs without dependencies installed so the matrix step can be cheap.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Repository root. The script is invoked from the repo root in CI (and via
 * `node tools/build-example-matrix.mjs` locally), so `process.cwd()` is the
 * authoritative location without hard-coding the script's relative path.
 *
 * @type {string}
 */
const repoRoot = process.cwd();

/**
 * Recursively walks `dir`, collecting absolute paths of every `package.json`
 * found. Skips `node_modules` directories so installed dependencies don't
 * pollute the result.
 *
 * @param {string} dir Directory to walk.
 * @param {string[]} [results=[]] Accumulator for matched paths; pass when
 *   recursing, omit at the top-level call.
 * @returns {string[]} Absolute paths of every discovered `package.json`.
 */
function findPackageJsonFiles(dir, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findPackageJsonFiles(full, results);
    } else if (entry.isFile() && entry.name === "package.json") {
      results.push(full);
    }
  }
  return results;
}

/**
 * Returns whether a parsed package.json is marked private. Tolerates the
 * boolean `true` and the string `"true"`
 *
 * @param {{ private?: boolean | string }} pkg Parsed package.json contents.
 * @returns {boolean} `true` if the package should be excluded from the matrix.
 */
function isPrivate(pkg) {
  return pkg.private === true || pkg.private === "true";
}

/**
 * Default Terraform version pulled from `.terraform.versions.json`. Used as
 * the single entry in the matrix's `terraform` axis so every example runs
 * against the project-wide default.
 *
 * @type {string}
 */
const tfDefault = JSON.parse(
  readFileSync(join(repoRoot, ".terraform.versions.json"), "utf8"),
).default;

/**
 * Sorted list of `@examples/*` workspace names that should appear in the
 * matrix. Workspaces with a truthy `private` field are excluded.
 *
 * @type {string[]}
 */
const targets = findPackageJsonFiles(join(repoRoot, "examples"))
  .map((file) => JSON.parse(readFileSync(file, "utf8")))
  .filter((pkg) => pkg.name && pkg.name.startsWith("@examples/"))
  .filter((pkg) => !isPrivate(pkg))
  .map((pkg) => pkg.name)
  .sort();

/**
 * GitHub Actions matrix object combining the example list with the default
 * Terraform version and both HCL output modes. Serialised to stdout so the
 * workflow can append it to `$GITHUB_OUTPUT`.
 *
 * @type {{ target: string[], terraform: string[], hclOutput: boolean[] }}
 */
const matrix = {
  target: targets,
  terraform: [tfDefault],
  hclOutput: [false, true],
};

process.stdout.write(JSON.stringify(matrix));
