// ─────────────────────────────────────────────
//  CodeAtlas · Parser Service
//  Tree-sitter AST parsing & entity extraction
// ─────────────────────────────────────────────

import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import logger from '../utils/logger.js';

/** Shared parser instance (reused across files). */
const parser = new Parser();
parser.setLanguage(JavaScript);

/**
 * Parses source code into a Tree-sitter AST.
 *
 * @param {string} code – Raw source code
 * @returns {Parser.Tree} Parsed syntax tree
 */
export function parseCode(code) {
  return parser.parse(code);
}

// ─────────────────────────────────────────────
//  AST Traversal Helpers
// ─────────────────────────────────────────────

/** Node types that define a function scope. */
const FUNCTION_SCOPE_TYPES = new Set([
  'function_declaration',
  'arrow_function',
  'function_expression',
  'method_definition',
  'generator_function_declaration',
]);

/**
 * Resolves the name of the callee from a call_expression node.
 *
 * Handles:
 *   foo()          → "foo"
 *   obj.bar()      → "bar"
 *   obj.a.b.c()    → "c"
 *   foo.bar.baz()  → "baz"
 *
 * @param {Parser.SyntaxNode} callNode – A call_expression node
 * @returns {string|null} The callee name, or null if unresolvable
 */
function resolveCalleeName(callNode) {
  const fnNode = callNode.childForFieldName('function');
  if (!fnNode) return null;

  switch (fnNode.type) {
    case 'identifier':
      return fnNode.text;

    case 'member_expression': {
      // Take the rightmost property: obj.foo.bar() → "bar"
      const prop = fnNode.childForFieldName('property');
      return prop ? prop.text : null;
    }

    default:
      return null;
  }
}

/**
 * Resolves the name of a function-scope node.
 *
 * Handles named declarations, arrow-function variable assignments,
 * and class method definitions.
 *
 * @param {Parser.SyntaxNode} node – A function-scope node
 * @returns {string|null}
 */
function resolveFunctionName(node) {
  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name');
      return name ? name.text : null;
    }

    case 'method_definition': {
      const name = node.childForFieldName('name');
      return name ? name.text : null;
    }

    case 'arrow_function':
    case 'function_expression': {
      // Walk up to the variable_declarator parent
      const parent = node.parent;
      if (parent && parent.type === 'variable_declarator') {
        const name = parent.childForFieldName('name');
        return name ? name.text : null;
      }
      return null;
    }

    default:
      return null;
  }
}

// ─────────────────────────────────────────────
//  Entity Extraction
// ─────────────────────────────────────────────

/**
 * Extracts functions, imports, and function calls from an AST.
 *
 * The walker maintains a scope stack so every call_expression
 * can be attributed to the enclosing function (caller → callee).
 *
 * @param {Parser.Tree} tree – Tree-sitter syntax tree
 * @returns {{
 *   functions: string[],
 *   imports: string[],
 *   calls: { caller: string, callee: string }[]
 * }}
 */
export function extractEntities(tree) {
  const functions = [];
  const imports = [];
  const calls = [];

  /** Stack of enclosing function names (innermost last). */
  const scopeStack = [];

  /**
   * Recursive AST walk with scope tracking.
   * We push/pop the scope stack around function-scope nodes
   * so that call_expressions inside always know their caller.
   */
  function walk(node) {
    const isFunctionScope = FUNCTION_SCOPE_TYPES.has(node.type);
    let scopeName = null;

    // ── Enter function scope ───────────────────
    if (isFunctionScope) {
      scopeName = resolveFunctionName(node);

      // Register the function in the declarations list
      if (scopeName) {
        functions.push(scopeName);
      }

      scopeStack.push(scopeName || '<anonymous>');
    }

    // ── Handle node types ──────────────────────
    switch (node.type) {
      // --- Imports (ESM) ---
      case 'import_statement': {
        const source = node.childForFieldName('source');
        if (source) {
          imports.push(source.text.replace(/['"]/g, ''));
        }
        break;
      }

      // --- Imports (CJS) & general call detection ---
      case 'call_expression': {
        const calleeName = resolveCalleeName(node);

        if (calleeName === 'require') {
          // CJS require() → treat as import
          const args = node.childForFieldName('arguments');
          if (args && args.namedChildCount > 0) {
            const firstArg = args.namedChild(0);
            if (firstArg.type === 'string') {
              imports.push(firstArg.text.replace(/['"]/g, ''));
            }
          }
        } else if (calleeName) {
          // Regular function call → record caller→callee
          const caller =
            scopeStack.length > 0
              ? scopeStack[scopeStack.length - 1]
              : '<module>';

          calls.push({ caller, callee: calleeName });
        }
        break;
      }

      // --- Variable-assigned arrow functions (no scope push above) ---
      // Already handled by isFunctionScope + resolveFunctionName
      // for arrow_function. But we still need to catch plain
      // lexical/variable declarations that assign non-arrow values.
      case 'lexical_declaration':
      case 'variable_declaration': {
        // Only register functions not already caught as arrow_function scope.
        // This handles: const foo = function() {} (function_expression).
        // arrow_function and function_expression are already caught
        // by isFunctionScope, so we don't double-register here.
        break;
      }
    }

    // ── Recurse into children ──────────────────
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }

    // ── Exit function scope ────────────────────
    if (isFunctionScope) {
      scopeStack.pop();
    }
  }

  walk(tree.rootNode);

  return { functions, imports, calls };
}
