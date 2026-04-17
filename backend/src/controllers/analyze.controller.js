// ─────────────────────────────────────────────
//  CodeAtlas · Analyze Controller
//  Orchestrates the full analysis pipeline
// ─────────────────────────────────────────────

import { readFile } from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { cloneRepo, cleanupRepo } from '../services/repo.service.js';
import { scanFiles } from '../services/file.service.js';
import { parseCode, extractEntities } from '../services/parser.service.js';
import { buildGraph, computeRiskScores } from '../services/graph.service.js';
import { analyzeHotspots } from '../services/git.service.js';
import {
  getRepoMetadata,
  getContributors,
  getLanguages,
  getCommitIntelligence,
  getPRIntelligence,
  computeEnhancedHotspots,
} from '../services/github.service.js';
import { generateCodeExplanation, extractFunctionCode } from '../services/ai.service.js';
import logger from '../utils/logger.js';

/**
 * Normalizes an absolute file path relative to the repo root.
 * (mirrors graph.service.js normalizePath for consistency)
 */
function normalizePath(filePath, repoRoot) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function parseGitHubUrl(url) {
  const match = url.match(/^https?:\/\/(www\.)?github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  return { owner: match[2], repo: match[3].replace('.git', '') };
}

/**
 * POST /api/analyze/github
 *
 * Accepts { repoUrl } in the request body, clones the repo,
 * runs the full analysis pipeline, and returns structured JSON
 * with nodes (+ risk scores, + owners), edges (+ call edges), and hotspots.
 */
export async function analyzeGithubRepo(req, res) {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({
      error: 'Missing required field: repoUrl',
    });
  }

  const repoInfo = parseGitHubUrl(repoUrl);
  if (!repoInfo) {
    return res.status(400).json({
      error: 'Invalid GitHub repository URL',
    });
  }

  const { owner, repo } = repoInfo;
  let repoPath = null;
  const pipelineTimer = logger.timer('full pipeline');

  try {
    // ── 0. Fetch GitHub Intelligence (Parallel) ────
    logger.info(`Fetching GitHub intelligence for ${owner}/${repo}...`);
    const [
      repoMetadata,
      contributors,
      languages,
      commitIntelligence,
      prIntelligence
    ] = await Promise.all([
      getRepoMetadata(owner, repo),
      getContributors(owner, repo),
      getLanguages(owner, repo),
      getCommitIntelligence(owner, repo),
      getPRIntelligence(owner, repo)
    ]);

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
        meta: { totalFiles: 0, totalFunctions: 0, totalCalls: 0 },
      });
    }

    // ── 3. Parse & extract ────────────────────────
    const parseTimer = logger.timer('parse + extract');
    const fileEntities = new Map();

    /** @type {Map<string, number>} relPath → line count */
    const fileLOC = new Map();

    let totalFunctions = 0;
    let totalCalls = 0;
    let parseErrors = 0;

    const parsePromises = filePaths.map(async (filePath) => {
      try {
        const code = await readFile(filePath, 'utf-8');
        const tree = parseCode(code);
        const entities = extractEntities(tree);

        fileEntities.set(filePath, entities);
        totalFunctions += entities.functions.length;
        totalCalls += entities.calls.length;

        // Track LOC for risk scoring
        const relPath = normalizePath(filePath, repoPath);
        const lineCount = code.split('\n').length;
        fileLOC.set(relPath, lineCount);
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

    logger.info(`Detected ${totalCalls} function calls across ${filePaths.length} files`);

    // ── 4. Build graph ────────────────────────────
    const { nodes, edges, totalCalls: graphCalls } = buildGraph(
      fileEntities,
      repoPath,
      commitIntelligence.ownership
    );

    // ── 5. Hotspot analysis ───────────────────────
    // Get CLI hotspots
    const cliHotspots = await analyzeHotspots(repoPath);
    
    // Compute enhanced hotspots
    const enhancedHotspots = computeEnhancedHotspots(
      cliHotspots,
      commitIntelligence.fileFrequency,
      prIntelligence.churnMap
    );

    // ── 6. Risk scoring ───────────────────────────
    computeRiskScores(nodes, edges, enhancedHotspots, fileLOC);

    // ── 7. Respond ────────────────────────────────
    const elapsed = pipelineTimer.end();

    const response = {
      nodes,
      edges,
      hotspots: enhancedHotspots,
      contributors,
      ownership: commitIntelligence.ownership,
      repo: {
        name: repoMetadata?.name,
        stars: repoMetadata?.stargazers_count,
        forks: repoMetadata?.forks_count,
        issues: repoMetadata?.open_issues_count,
        language: repoMetadata?.language,
        size: repoMetadata?.size,
        languages: languages.percentages
      },
      activity: commitIntelligence.activity,
      pullRequests: prIntelligence,
      meta: {
        totalFiles: filePaths.length,
        totalFunctions,
        totalCalls: graphCalls,
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
    // ── 8. Cleanup ──────────────────────────────
    if (repoPath) {
      await cleanupRepo(repoPath);
    }
  }
}

/**
 * POST /api/analyze/explain
 * 
 * Explains a function using AI.
 * Requires { nodeId, repoUrl, code, dependencies } in body.
 * Note: Since the backend is stateless, it either expects 'code' in the body directly,
 * or it fetches the file from GitHub rawusercontent using repoUrl and nodeId.
 */
export async function explainNode(req, res) {
  const { nodeId, repoUrl, code, dependencies = [] } = req.body;

  if (!nodeId) {
    return res.status(400).json({ error: 'Missing required field: nodeId' });
  }

  // Parse nodeId: "filePath:functionName"
  const parts = nodeId.split(':');
  if (parts.length < 2) {
    return res.status(400).json({ error: 'Invalid nodeId format. Expected "filePath:functionName"' });
  }

  const filePath = parts[0];
  const functionName = parts[1];

  let sourceCode = code;

  // If no code provided, fetch from GitHub
  if (!sourceCode) {
    if (!repoUrl) {
      return res.status(400).json({ error: 'Must provide either "code" or "repoUrl" to fetch the file.' });
    }

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) {
      return res.status(400).json({ error: 'Invalid repoUrl' });
    }

    try {
      logger.info(`Fetching file content from GitHub: ${repoInfo.owner}/${repoInfo.repo}/${filePath}`);
      const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/HEAD/${filePath}`;
      const response = await axios.get(rawUrl, { timeout: 10000 });
      sourceCode = response.data;
    } catch (err) {
      logger.error(`Failed to fetch file from GitHub: ${err.message}`);
      return res.status(500).json({ error: 'Failed to retrieve file contents for explanation.' });
    }
  }

  // Extract function block
  const functionCode = extractFunctionCode(sourceCode, functionName);

  // Generate explanation
  try {
    const { explanation, summary } = await generateCodeExplanation({
      code: functionCode,
      functionName,
      dependencies,
    });

    return res.status(200).json({
      explanation,
      summary,
      functionName,
      dependencies,
    });
  } catch (err) {
    logger.error(`Explanation failed: ${err.message}`);
    return res.status(500).json({ error: 'Failed to generate explanation.' });
  }
}
