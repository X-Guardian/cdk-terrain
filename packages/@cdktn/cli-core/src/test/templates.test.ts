// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { readFileSync, readdirSync } from "fs-extra";
import * as path from "path";
import { CODE_MARKER } from "@cdktn/hcl2cdk";

const templatesDir = path.resolve(__dirname, "..", "..", "templates");

describe("Templates", () => {
  describe("Typescript", () => {
    it("main.ts should contain the '// define resources here' mark", () => {
      expect(
        readFileSync(path.join(templatesDir, "typescript", "main.ts"), "utf8"),
      ).toContain(CODE_MARKER);
    });
  });

  // The package-manager variants reuse the `typescript` files through template variables. A file duplicated into a
  // variant directory silently replaces the base's copy, and a literal npm command in the base leaks into every variant.
  describe("typescript-pnpm", () => {
    it("does not shadow any file of the base template", () => {
      const baseFiles = readdirSync(path.join(templatesDir, "typescript"));
      const shadowed = readdirSync(
        path.join(templatesDir, "typescript-pnpm"),
      ).filter((file) => baseFiles.includes(file));

      expect(shadowed).toEqual([]);
    });

    it.each(["cdktf.json", "help", "package.json"])(
      "the base template's %s takes its package manager commands from variables",
      (file) => {
        const contents = readFileSync(
          path.join(templatesDir, "typescript", file),
          "utf8",
        );

        expect(contents).toMatch(/\{\{ pm(Run|Add|Exec) \}\}/);
        // The npmjs.com search URL is a registry link rather than a command, so it legitimately survives.
        expect(
          contents.replace(/https:\/\/www\.npmjs\.com\S*/g, ""),
        ).not.toMatch(/\b(npm (run|install|i) |npx )/);
      },
    );
  });
});
