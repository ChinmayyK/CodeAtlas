// ─────────────────────────────────────────────
//  CodeAtlas · Analyze Routes
// ─────────────────────────────────────────────

import { Router } from 'express';
import { analyzeGithubRepo } from '../controllers/analyze.controller.js';

const router = Router();

// POST /api/analyze/github
router.post('/github', analyzeGithubRepo);

export default router;
