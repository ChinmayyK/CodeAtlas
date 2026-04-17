// ─────────────────────────────────────────────
//  CodeAtlas · Graph Service
//  Builds a visualisation-ready dependency graph
// ─────────────────────────────────────────────

import path from 'path';
import logger from '../utils/logger.js';

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

/**
 * Constructs the dependency graph from per-file entity maps.
 *
 * @param {Map<string, { functions: string[], imports: string[] }>} fileEntities
 *   Map of absolute file paths → extracted entities
 * @param {string} repoRoot – Absolute path to the repo root
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildGraph(fileEntities, repoRoot) {
  const timer = logger.timer('graph build');

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();

  for (const [filePath, entities] of fileEntities) {
    const relPath = normalizePath(filePath, repoRoot);

    // ── File node ────────────────────────────────
    const fileNodeId = relPath;
    if (!nodeIds.has(fileNodeId)) {
      nodes.push({
        id: fileNodeId,
        label: path.basename(filePath),
        type: 'file',
        file: relPath,
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
  }

  timer.end();
  logger.info(`Graph: ${nodes.length} nodes, ${edges.length} edges`);

  return { nodes, edges };
}
