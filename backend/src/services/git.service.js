// ─────────────────────────────────────────────
//  CodeAtlas · Git Service
//  Hotspot analysis via commit frequency
// ─────────────────────────────────────────────

import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

/**
 * Analyses git log to find files that change most frequently.
 * High-churn files are often complexity hotspots worth investigating.
 *
 * @param {string} repoPath – Absolute path to the cloned repo
 * @returns {Promise<Record<string, number>>} Map of filePath → change count
 */
export async function analyzeHotspots(repoPath) {
  const timer = logger.timer('hotspot analysis');

  try {
    const { stdout } = await execAsync(
      'git log --name-only --pretty=format:',
      { cwd: repoPath, timeout: 30_000 }
    );

    const hotspots = {};

    const lines = stdout.split('\n').filter((line) => line.trim() !== '');

    for (const file of lines) {
      const trimmed = file.trim();
      if (trimmed) {
        hotspots[trimmed] = (hotspots[trimmed] || 0) + 1;
      }
    }

    // Sort by frequency (descending) and return top entries
    const sorted = Object.entries(hotspots)
      .sort(([, a], [, b]) => b - a)
      .reduce((acc, [key, val]) => {
        acc[key] = val;
        return acc;
      }, {});

    timer.end();
    logger.info(`Hotspots: ${Object.keys(sorted).length} files tracked`);

    return sorted;
  } catch (err) {
    logger.warn(`Hotspot analysis failed: ${err.message}`);
    return {};
  }
}
