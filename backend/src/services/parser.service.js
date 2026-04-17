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

/**
 * Walks a Tree-sitter node tree, calling `visitor` for every node.
 *
 * @param {Parser.SyntaxNode} node
 * @param {(node: Parser.SyntaxNode) => void} visitor
 */
function walk(node, visitor) {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    walk(node.child(i), visitor);
  }
}

/**
 * Extracts function declarations and import statements from an AST.
 *
 * @param {Parser.Tree} tree – Tree-sitter syntax tree
 * @returns {{ functions: string[], imports: string[] }}
 */
export function extractEntities(tree) {
  const functions = [];
  const imports = [];

  walk(tree.rootNode, (node) => {
    switch (node.type) {
      // ── Functions ──────────────────────────────
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          functions.push(nameNode.text);
        }
        break;
      }

      // Arrow functions assigned to variables: const foo = () => {}
      case 'lexical_declaration':
      case 'variable_declaration': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const declarator = node.namedChild(i);
          if (declarator.type === 'variable_declarator') {
            const nameNode = declarator.childForFieldName('name');
            const valueNode = declarator.childForFieldName('value');
            if (
              nameNode &&
              valueNode &&
              valueNode.type === 'arrow_function'
            ) {
              functions.push(nameNode.text);
            }
          }
        }
        break;
      }

      // Class methods
      case 'method_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          functions.push(nameNode.text);
        }
        break;
      }

      // ── Imports ────────────────────────────────
      case 'import_statement': {
        const source = node.childForFieldName('source');
        if (source) {
          // Strip surrounding quotes
          imports.push(source.text.replace(/['"]/g, ''));
        }
        break;
      }

      // require() calls
      case 'call_expression': {
        const callee = node.childForFieldName('function');
        if (callee && callee.text === 'require') {
          const args = node.childForFieldName('arguments');
          if (args && args.namedChildCount > 0) {
            const firstArg = args.namedChild(0);
            if (firstArg.type === 'string') {
              imports.push(firstArg.text.replace(/['"]/g, ''));
            }
          }
        }
        break;
      }
    }
  });

  return { functions, imports };
}
