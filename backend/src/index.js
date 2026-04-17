// ─────────────────────────────────────────────
//  CodeAtlas · Server Entry Point
// ─────────────────────────────────────────────

import express from 'express';
import analyzeRoutes from './routes/analyze.routes.js';
import logger from './utils/logger.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// CORS (allow frontend dev server)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

import { explainNode } from './controllers/analyze.controller.js';

// ── Routes ──────────────────────────────────────
app.use('/api/analyze', analyzeRoutes);
app.post('/api/explain', explainNode);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── 404 handler ─────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ───────────────────────────────────────
app.listen(PORT, () => {
  logger.success(`CodeAtlas server running on http://localhost:${PORT}`);
  logger.info('Endpoints:');
  logger.info('  POST /api/analyze/github');
  logger.info('  GET  /api/health');
});
