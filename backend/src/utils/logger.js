// ─────────────────────────────────────────────
//  CodeAtlas · Structured Logger
// ─────────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

/**
 * Formats a timestamp for log output.
 * @returns {string} ISO-style timestamp
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Core log function with level colouring.
 */
function log(level, color, ...args) {
  const prefix = `${COLORS.dim}${timestamp()}${COLORS.reset} ${color}[${level}]${COLORS.reset}`;
  console.log(prefix, ...args);
}

const logger = {
  info: (...args) => log('INFO', COLORS.cyan, ...args),
  success: (...args) => log('OK', COLORS.green, ...args),
  warn: (...args) => log('WARN', COLORS.yellow, ...args),
  error: (...args) => log('ERROR', COLORS.red, ...args),
  timer: (label) => {
    const start = performance.now();
    return {
      end: () => {
        const elapsed = (performance.now() - start).toFixed(2);
        log('TIMER', COLORS.magenta, `${label} completed in ${elapsed}ms`);
        return Number(elapsed);
      },
    };
  },
};

export default logger;
