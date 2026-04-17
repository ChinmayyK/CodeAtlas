// ─────────────────────────────────────────────
//  CodeAtlas · File Service
//  Recursive JS/TS file scanner
// ─────────────────────────────────────────────

import { readdir, stat } from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

/** Directories that should never be traversed. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
]);

/** File extensions we care about. */
const ALLOWED_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs']);

/**
 * Recursively scans a directory for JS/TS source files.
 *
 * @param {string} dirPath – Root directory to scan
 * @returns {Promise<string[]>} Array of absolute file paths
 */
export async function scanFiles(dirPath) {
  const timer = logger.timer('file scan');
  const results = [];

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    const promises = entries.map(async (entry) => {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
        return;
      }

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    });

    await Promise.all(promises);
  }

  await walk(dirPath);
  timer.end();
  logger.info(`Found ${results.length} source files`);

  return results;
}
