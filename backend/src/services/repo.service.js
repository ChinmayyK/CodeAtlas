// ─────────────────────────────────────────────
//  CodeAtlas · Repo Service
//  Clone & cleanup GitHub repositories
// ─────────────────────────────────────────────

import { exec } from 'child_process';
import { rm, stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

/** Maximum repo size in MB before we bail out. */
const MAX_REPO_SIZE_MB = 500;

/**
 * Shallow-clones a GitHub repository into a timestamped temp directory.
 *
 * @param {string} repoUrl   – HTTPS URL of the GitHub repo
 * @param {string} [basePath] – Parent directory for clones (default: ./tmp)
 * @returns {Promise<string>} Absolute path to the cloned repo
 */
export async function cloneRepo(repoUrl, basePath = './tmp') {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('A valid GitHub repository URL is required.');
  }

  const folderName = `repo_${Date.now()}`;
  const targetPath = path.resolve(basePath, folderName);

  logger.info(`Cloning ${repoUrl} → ${targetPath}`);
  const timer = logger.timer('git clone');

  try {
    // Shallow clone (depth 50 keeps enough history for hotspot analysis)
    await execAsync(`git clone --depth 50 "${repoUrl}" "${targetPath}"`, {
      timeout: 120_000, // 2 min hard limit
    });
    timer.end();

    // ── Size guard ──────────────────────────────────
    const dirStat = await execAsync(`du -sm "${targetPath}"`);
    const sizeMB = parseInt(dirStat.stdout.split('\t')[0], 10);

    if (sizeMB > MAX_REPO_SIZE_MB) {
      await cleanupRepo(targetPath);
      throw new Error(
        `Repository is too large (${sizeMB} MB). Limit is ${MAX_REPO_SIZE_MB} MB.`
      );
    }

    logger.success(`Clone complete — ${sizeMB} MB on disk`);
    return targetPath;
  } catch (err) {
    // If clone itself failed, make sure we don't leave orphan dirs
    await cleanupRepo(targetPath).catch(() => {});
    throw new Error(`Failed to clone repository: ${err.message}`);
  }
}

/**
 * Removes a cloned repo directory.
 *
 * @param {string} repoPath – Absolute path to the repo directory
 */
export async function cleanupRepo(repoPath) {
  try {
    await stat(repoPath);
    await rm(repoPath, { recursive: true, force: true });
    logger.info(`Cleaned up ${repoPath}`);
  } catch {
    // Directory doesn't exist — nothing to do
  }
}
