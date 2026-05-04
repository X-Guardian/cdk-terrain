/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

const { nxPreset } = require('@nx/jest/preset');

module.exports = {
  ...nxPreset,
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  coverageReporters: ['text', 'text-summary', 'json-summary'],
};
