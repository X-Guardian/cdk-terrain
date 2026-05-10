/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

module.exports = {
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // The package currently has no tests. Don't fail the test target on that —
  // build / typecheck still runs as part of the package's pretest hook.
  passWithNoTests: true,
  "transform": {
    "^.+\\.tsx?$": "ts-jest"
  },
  moduleFileExtensions: [
    "js",
    "ts",
    "tsx"
  ],
}
