// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { zipSync } from "fflate";
import { assetCanNotCreateZipArchive } from "../errors";

const HASH_LEN = 32;

// Full implementation at https://github.com/jprichardson/node-fs-extra/blob/master/lib/copy/copy-sync.js
/**
 * Copy a file or directory. The directory can have contents and subfolders.
 * @param {string} src
 * @param {string} dest
 */
export function copySync(src: string, dest: string) {
  /**
   * Copies file if present otherwise walks subfolder
   * @param {string} p
   */
  function copyItem(p: string) {
    const sourcePath = path.resolve(src, p);
    const stat = fs.statSync(sourcePath);
    if (stat.isFile()) {
      fs.copyFileSync(sourcePath, path.resolve(dest, p));
    }
    if (stat.isDirectory()) {
      walkSubfolder(p);
    }
  }
  /**
   * Copies contents of subfolder
   * @param {string} p
   */
  function walkSubfolder(p: string) {
    const sourceDir = path.resolve(src, p);
    fs.mkdirSync(path.resolve(dest, p), { recursive: true });
    fs.readdirSync(sourceDir).forEach((item: string) =>
      copyItem(path.join(p, item)),
    );
  }

  walkSubfolder(".");
}

/**
 * Zips contents at src and places zip archive at dest
 * @param {string} src
 * @param {string} dest
 */
export function archiveSync(src: string, dest: string) {
  try {
    const files: Record<string, Uint8Array> = {};
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const zipPath = prefix ? `${prefix}/${entry}` : entry;
        if (fs.statSync(full).isDirectory()) {
          walk(full, zipPath);
        } else {
          files[zipPath] = fs.readFileSync(full);
        }
      }
    };
    walk(src, "");
    fs.writeFileSync(dest, zipSync(files, { level: 9 }));
  } catch (err: any) {
    throw assetCanNotCreateZipArchive(src, dest, err);
  }
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function hashPath(src: string) {
  const hash = crypto.createHash("md5");

  // eslint-disable-next-line jsdoc/require-jsdoc
  function hashRecursion(p: string) {
    const stat = fs.statSync(p);
    if (stat.isFile()) {
      hash.update(fs.readFileSync(p));
    } else if (stat.isDirectory()) {
      fs.readdirSync(p).forEach((filename) =>
        hashRecursion(path.resolve(p, filename)),
      );
    }
  }

  hashRecursion(src);
  return hash.digest("hex").slice(0, HASH_LEN).toUpperCase();
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function findFileAboveCwd(
  file: string,
  rootPath = process.cwd(),
): string | null {
  const fullPath = path.resolve(rootPath, file);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }

  const parentDir = path.resolve(rootPath, "..");
  if (fs.existsSync(parentDir) && parentDir !== rootPath) {
    return findFileAboveCwd(file, parentDir);
  }

  return null;
}
