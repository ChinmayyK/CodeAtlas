// ─────────────────────────────────────────────
//  CodeAtlas · Graph Service
//  Builds a visualisation-ready dependency graph
//  with function-level call edges & risk scores
// ─────────────────────────────────────────────

import path from 'path';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────
//  Path Utilities
// ─────────────────────────────────────────────

/**
 * Normalizes an absolute file path relative to the repo root
 * so graph IDs are stable and human-readable.
 *
 * @param {string} filePath – Absolute path to the file
 * @param {string} repoRoot – Absolute path to the cloned repo root
 * @returns {string} Relative, forward-slash normalised path
 */
function normalizePath(filePath, repoRoot) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

/**
 * Resolves an import specifier relative to the importing file.
 * Only resolves relative imports (./  ../) — bare specifiers are returned as-is.
 *
 * @param {string} importPath  – Raw import specifier
 * @param {string} filePath    – Absolute path of the importing file
 * @param {string} repoRoot    – Absolute repo root
 * @returns {string} Normalised import target
 */
function resolveImportPath(importPath, filePath, repoRoot) {
  if (importPath.startsWith('.')) {
    const dir = path.dirname(filePath);
    const resolved = path.resolve(dir, importPath);
    return normalizePath(resolved, repoRoot);
  }
  // Bare / package imports — keep as-is
  return importPath;
}

// ─────────────────────────────────────────────
//  Graph Builder
// ─────────────────────────────────────────────

/**
 * Constructs the full dependency graph from per-file entity maps.
 *
 * Produces:
 *  - File nodes + function nodes
 *  - Import edges (file → file)
 *  - Contains edges (file → function)
 *  - Call edges (function → function)
 *
 * @param {Map<string, { functions: string[], imports: string[], calls: { caller: string, callee: string }[] }>} fileEntities
 * @param {string} repoRoot
 * @param {Record<string, any>} [ownership={}]
 * @returns {{ nodes: object[], edges: object[], totalCalls: number }}
 */
export function buildGraph(fileEntities, repoRoot, ownership = {}) {
  const timer = logger.timer('graph build');

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();

  // ── Pre-index: function name → list of qualified IDs ──
  // Enables O(1) lookup when resolving call targets.
  /** @type {Map<string, string[]>} */
  const functionIndex = new Map();

  for (const [filePath, entities] of fileEntities) {
    const relPath = normalizePath(filePath, repoRoot);
    for (const fn of entities.functions) {
      const qualifiedId = `${relPath}:${fn}`;
      if (!functionIndex.has(fn)) {
        functionIndex.set(fn, []);
      }
      functionIndex.get(fn).push(qualifiedId);
    }
  }

  // ── Edge dedup + weight tracking ──────────────
  /** @type {Map<string, { edge: object, weight: number }>} */
  const callEdgeMap = new Map();
  let totalCalls = 0;

  // ── Build nodes & edges ───────────────────────
  for (const [filePath, entities] of fileEntities) {
    const relPath = normalizePath(filePath, repoRoot);

    const fileOwner = ownership[relPath]?.topContributor || null;

    // ── File node ────────────────────────────────
    const fileNodeId = relPath;
    if (!nodeIds.has(fileNodeId)) {
      nodes.push({
        id: fileNodeId,
        label: path.basename(filePath),
        type: 'file',
        file: relPath,
        owner: fileOwner,
      });
      nodeIds.add(fileNodeId);
    }

    // ── Function nodes ──────────────────────────
    for (const fn of entities.functions) {
      const fnNodeId = `${relPath}:${fn}`;
      if (!nodeIds.has(fnNodeId)) {
        nodes.push({
          id: fnNodeId,
          label: fn,
          type: 'function',
          file: relPath,
          owner: fileOwner,
        });
        nodeIds.add(fnNodeId);

        // Edge: file contains function
        edges.push({
          source: fileNodeId,
          target: fnNodeId,
          type: 'contains',
        });
      }
    }

    // ── Import edges ────────────────────────────
    for (const imp of entities.imports) {
      const resolvedTarget = resolveImportPath(imp, filePath, repoRoot);

      // Ensure the target node exists (may be external)
      if (!nodeIds.has(resolvedTarget)) {
        const isExternal = !imp.startsWith('.');
        nodes.push({
          id: resolvedTarget,
          label: isExternal ? imp : path.basename(resolvedTarget),
          type: isExternal ? 'external' : 'file',
          file: resolvedTarget,
        });
        nodeIds.add(resolvedTarget);
      }

      edges.push({
        source: fileNodeId,
        target: resolvedTarget,
        type: 'import',
      });
    }

    // ── Call edges (function → function) ─────────
    for (const { caller, callee } of entities.calls) {
      totalCalls++;

      // Skip module-level or anonymous callers
      if (caller === '<module>' || caller === '<anonymous>') continue;

      const callerQualified = `${relPath}:${caller}`;

      // Caller must exist in the graph
      if (!nodeIds.has(callerQualified)) continue;

      // Resolve callee target
      const calleeTarget = resolveCallTarget(
        callee,
        relPath,
        functionIndex
      );

      if (!calleeTarget) continue;

      // Deduplicate & accumulate weight
      const edgeKey = `${callerQualified}→${calleeTarget}`;

      if (callEdgeMap.has(edgeKey)) {
        callEdgeMap.get(edgeKey).weight++;
      } else {
        const edge = {
          source: callerQualified,
          target: calleeTarget,
          type: 'calls',
          callType: 'internal',
          weight: 1,
        };
        callEdgeMap.set(edgeKey, edge);
      }
    }
  }

  // ── Flush call edges into main edge array ─────
  for (const edgeData of callEdgeMap.values()) {
    edges.push(edgeData);
  }

  timer.end();

  const callEdgeCount = callEdgeMap.size;
  logger.info(
    `Graph: ${nodes.length} nodes, ${edges.length} edges (${callEdgeCount} call edges from ${totalCalls} raw calls)`
  );

  return { nodes, edges, totalCalls };
}

/**
 * Resolves a callee name to a qualified function node ID.
 *
 * Strategy:
 *  1. Same-file match (prefer local scope)
 *  2. Cross-file match (first found in index)
 *  3. null if unresolved
 *
 * @param {string} callee        – Bare function name
 * @param {string} currentFile   – Relative path of the calling file
 * @param {Map<string, string[]>} functionIndex – Pre-built name → ID index
 * @returns {string|null}
 */
function resolveCallTarget(callee, currentFile, functionIndex) {
  const candidates = functionIndex.get(callee);
  if (!candidates || candidates.length === 0) return null;

  // Prefer same-file match
  const sameFile = candidates.find((id) => id.startsWith(currentFile + ':'));
  if (sameFile) return sameFile;

  // Cross-file match — return first (deterministic since Map iteration is stable)
  return candidates[0];
}

// ─────────────────────────────────────────────
//  Risk Scoring Engine
// ─────────────────────────────────────────────

/**
 * Computes a risk score (0–100) for every node in the graph.
 *
 * Formula:
 *   risk = (hotspotScore × 0.5) + (degreeCentrality × 0.3) + (fileSizeFactor × 0.2)
 *
 * @param {object[]} nodes       – Graph nodes
 * @param {object[]} edges       – Graph edges
 * @param {Record<string, number>} hotspots – File → change count
 * @param {Map<string, number>} fileLOC    – File relative path → line count
 * @returns {object[]} Nodes with `risk` property attached
 */
export function computeRiskScores(nodes, edges, hotspots, fileLOC) {
  const timer = logger.timer('risk scoring');

  // ── 1. Degree centrality per node ─────────────
  /** @type {Map<string, number>} */
  const degree = new Map();

  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }

  const maxDegree = Math.max(1, ...degree.values());

  // ── 2. Hotspot normalization ──────────────────
  const hotspotValues = Object.values(hotspots);
  const maxHotspot = Math.max(1, ...hotspotValues);

  // ── 3. File size normalization ────────────────
  const locValues = [...fileLOC.values()];
  const maxLOC = Math.max(1, ...locValues);

  // ── 4. Score each node ────────────────────────
  for (const node of nodes) {
    // Hotspot: use the node's file path to look up change frequency
    const fileHotspot = hotspots[node.file] || 0;
    const hotspotScore = (fileHotspot / maxHotspot) * 100;

    // Degree centrality
    const nodeDegree = degree.get(node.id) || 0;
    const degreeCentrality = (nodeDegree / maxDegree) * 100;

    // File size (LOC)
    const loc = fileLOC.get(node.file) || 0;
    const fileSizeFactor = (loc / maxLOC) * 100;

    // Weighted formula
    const risk = Math.round(
      hotspotScore * 0.5 + degreeCentrality * 0.3 + fileSizeFactor * 0.2
    );

    node.risk = Math.min(100, Math.max(0, risk));
  }

  timer.end();
  logger.info(`Risk scores computed for ${nodes.length} nodes`);

  return nodes;
}
