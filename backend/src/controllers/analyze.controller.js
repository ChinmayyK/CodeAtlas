// ─────────────────────────────────────────────
//  CodeAtlas · Analyze Controller
//  Orchestrates the full analysis pipeline
// ─────────────────────────────────────────────

import { readFile } from 'fs/promises';
import { cloneRepo, cleanupRepo } from '../services/repo.service.js';
import { scanFiles } from '../services/file.service.js';
import { parseCode, extractEntities } from '../services/parser.service.js';
import { buildGraph } from '../services/graph.service.js';
import { analyzeHotspots } from '../services/git.service.js';
import logger from '../utils/logger.js';

/**
 * POST /api/analyze/github
 *
 * Accepts { repoUrl } in the request body, clones the repo,
 * runs the full analysis pipeline, and returns structured JSON.
 */
export async function analyzeGithubRepo(req, res) {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({
      error: 'Missing required field: repoUrl',
    });
  }

  // Basic URL validation
  const githubUrlPattern = /^https?:\/\/(www\.)?github\.com\/.+\/.+/i;
  if (!githubUrlPattern.test(repoUrl)) {
    return res.status(400).json({
      error: 'Invalid GitHub repository URL',
    });
  }

  let repoPath = null;
  const pipelineTimer = logger.timer('full pipeline');

  try {
    // ── 1. Clone ──────────────────────────────────
    repoPath = await cloneRepo(repoUrl);

    // ── 2. Scan files ─────────────────────────────
    const filePaths = await scanFiles(repoPath);

    if (filePaths.length === 0) {
      await cleanupRepo(repoPath);
      return res.status(200).json({
        nodes: [],
        edges: [],
        hotspots: {},
        meta: { totalFiles: 0, totalFunctions: 0 },
      });
    }

    // ── 3. Parse & extract ────────────────────────
    const parseTimer = logger.timer('parse + extract');
    const fileEntities = new Map();
    let totalFunctions = 0;
    let parseErrors = 0;

    const parsePromises = filePaths.map(async (filePath) => {
      try {
        const code = await readFile(filePath, 'utf-8');
        const tree = parseCode(code);
        const entities = extractEntities(tree);

        fileEntities.set(filePath, entities);
        totalFunctions += entities.functions.length;
      } catch (err) {
        parseErrors++;
        logger.warn(`Parse error in ${filePath}: ${err.message}`);
      }
    });

    await Promise.all(parsePromises);
    parseTimer.end();

    if (parseErrors > 0) {
      logger.warn(`${parseErrors} file(s) had parse errors`);
    }

    // ── 4. Build graph ────────────────────────────
    const { nodes, edges } = buildGraph(fileEntities, repoPath);

    // ── 5. Hotspot analysis ───────────────────────
    const hotspots = await analyzeHotspots(repoPath);

    // ── 6. Respond ────────────────────────────────
    const elapsed = pipelineTimer.end();

    const response = {
      nodes,
      edges,
      hotspots,
      meta: {
        totalFiles: filePaths.length,
        totalFunctions,
        parseErrors,
        analysisTimeMs: elapsed,
      },
    };

    return res.status(200).json(response);
  } catch (err) {
    logger.error(`Pipeline failed: ${err.message}`);
    return res.status(500).json({
      error: 'Analysis failed',
      message: err.message,
    });
  } finally {
    // ── 7. Cleanup ──────────────────────────────
    if (repoPath) {
      await cleanupRepo(repoPath);
    }
  }
}
