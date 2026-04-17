// ─────────────────────────────────────────────
//  CodeAtlas · AI Explainer Service
//  OpenAI-powered code explanation engine
// ─────────────────────────────────────────────

import OpenAI from 'openai';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────
//  Client Initialisation
// ─────────────────────────────────────────────

/** @type {OpenAI|null} */
let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn('OPENAI_API_KEY not set — AI explanations will use fallback');
      return null;
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

// ─────────────────────────────────────────────
//  In-memory Cache
// ─────────────────────────────────────────────

/** @type {Map<string, { explanation: string, summary: string, ts: number }>} */
const explanationCache = new Map();

/** Cache TTL: 30 minutes */
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Returns cached result if still fresh, otherwise null.
 * @param {string} key
 */
function getCached(key) {
  const entry = explanationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    explanationCache.delete(key);
    return null;
  }
  return entry;
}

// ─────────────────────────────────────────────
//  Code Extraction (lightweight)
// ─────────────────────────────────────────────

/**
 * Extracts a function body from source code by name.
 *
 * Uses a simple brace-counting approach — intentionally not
 * a full parser pass since tree-sitter already parsed earlier.
 *
 * @param {string} code          – Full file source
 * @param {string} functionName  – Function to extract
 * @returns {string} Extracted code (or full file if not found, capped)
 */
export function extractFunctionCode(code, functionName) {
  const lines = code.split('\n');

  // Find the line that declares / assigns the function
  const patterns = [
    new RegExp(`function\\s+${escapeRegex(functionName)}\\s*\\(`),
    new RegExp(`(const|let|var)\\s+${escapeRegex(functionName)}\\s*=`),
    new RegExp(`${escapeRegex(functionName)}\\s*\\(`),
  ];

  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) {
    // Couldn't find it — return truncated full file
    return lines.slice(0, 60).join('\n');
  }

  // Count braces to find the end of the function
  let braceCount = 0;
  let foundFirstBrace = false;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        braceCount++;
        foundFirstBrace = true;
      } else if (ch === '}') {
        braceCount--;
      }
    }

    endLine = i;

    if (foundFirstBrace && braceCount <= 0) {
      break;
    }

    // Safety: don't extract more than 80 lines
    if (i - startLine > 80) break;
  }

  return lines.slice(startLine, endLine + 1).join('\n');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────
//  OpenAI Explanation Generator
// ─────────────────────────────────────────────

/**
 * Generates an AI-powered explanation of a function.
 *
 * @param {object} params
 * @param {string} params.code           – Extracted function source code
 * @param {string} params.functionName   – Name of the function
 * @param {string[]} params.dependencies – List of dependency identifiers
 * @returns {Promise<{ explanation: string, summary: string }>}
 */
export async function generateCodeExplanation({
  code,
  functionName,
  dependencies,
}) {
  // ── Check cache ───────────────────────────────
  const cacheKey = `${functionName}::${hashCode(code)}`;
  const cached = getCached(cacheKey);
  if (cached) {
    logger.info(`AI cache hit for ${functionName}`);
    return { explanation: cached.explanation, summary: cached.summary };
  }

  const openai = getClient();

  if (!openai) {
    return fallbackExplanation(functionName, dependencies);
  }

  const timer = logger.timer(`AI explain: ${functionName}`);

  const prompt = `You are a senior software engineer.

Explain the following function in simple terms.

Function Name: ${functionName}

Code:
\`\`\`javascript
${code}
\`\`\`

Dependencies: ${dependencies.length > 0 ? dependencies.join(', ') : 'None'}

Return:

1. What this function does
2. How it works (step-by-step)
3. Why it exists in the system
4. Any risks or complexity`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    });

    const explanation = response.choices[0]?.message?.content || '';

    // Generate a short summary from the first section
    const summaryMatch = explanation.match(
      /1\.\s*What this function does\s*\n([\s\S]*?)(?=\n2\.|\\n$)/
    );
    const summary = summaryMatch
      ? summaryMatch[1].trim()
      : explanation.slice(0, 120).trim();

    timer.end();

    // Cache result
    explanationCache.set(cacheKey, {
      explanation,
      summary,
      ts: Date.now(),
    });

    return { explanation, summary };
  } catch (err) {
    timer.end();
    logger.error(`OpenAI API error: ${err.message}`);
    return fallbackExplanation(functionName, dependencies);
  }
}

/**
 * Fallback when OpenAI is unavailable.
 */
function fallbackExplanation(functionName, dependencies) {
  const depText =
    dependencies.length > 0
      ? `It depends on: ${dependencies.join(', ')}.`
      : 'It has no detected dependencies.';

  return {
    explanation: `**${functionName}** — AI explanation unavailable. ${depText} Review the source code for details.`,
    summary: `Function "${functionName}" — explanation requires OPENAI_API_KEY.`,
  };
}

/**
 * Simple string hash for cache keying.
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}
