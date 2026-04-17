// ─────────────────────────────────────────────
//  CodeAtlas · GitHub Intelligence Service
//  Full analytics engine using GitHub REST API
// ─────────────────────────────────────────────

import axios from 'axios';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────
//  Client Initialisation
// ─────────────────────────────────────────────

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    logger.warn('GITHUB_TOKEN not set — heavy rate limits will apply!');
  }
  return axios.create({
    baseURL: 'https://api.github.com',
    headers,
    timeout: 15000,
  });
}

// ─────────────────────────────────────────────
//  API Methods
// ─────────────────────────────────────────────

export async function getRepoMetadata(owner, repo) {
  try {
    const client = getGitHubClient();
    const { data } = await client.get(`/repos/${owner}/${repo}`);
    return {
      name: data.name,
      full_name: data.full_name,
      description: data.description,
      size: data.size,
      stargazers_count: data.stargazers_count,
      forks_count: data.forks_count,
      open_issues_count: data.open_issues_count,
      default_branch: data.default_branch,
      language: data.language,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  } catch (err) {
    logger.warn(`Failed to fetch repo metadata: ${err.message}`);
    return null;
  }
}

export async function getRepoTree(owner, repo, branch = 'main') {
  try {
    const client = getGitHubClient();
    const { data } = await client.get(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    
    // Filter to only include JS/TS files, excluding common non-source dirs
    const allowedExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs']);
    const files = data.tree
      .filter((item) => item.type === 'blob')
      .filter((item) => {
        const ext = item.path.slice(((item.path.lastIndexOf('.') - 1) >>> 0) + 2);
        return allowedExts.has('.' + ext.toLowerCase());
      })
      .filter((item) => {
        return !item.path.includes('node_modules/') && !item.path.includes('dist/') && !item.path.includes('build/');
      })
      .map((item) => item.path);
      
    return files;
  } catch (err) {
    logger.warn(`Failed to fetch repo tree for ${branch}: ${err.message}`);
    return [];
  }
}

export async function getContributors(owner, repo) {
  try {
    const client = getGitHubClient();
    const { data } = await client.get(`/repos/${owner}/${repo}/contributors`, {
      params: { per_page: 100 },
    });
    return data.map((c) => ({
      login: c.login,
      contributions: c.contributions,
      avatar_url: c.avatar_url,
    }));
  } catch (err) {
    logger.warn(`Failed to fetch contributors: ${err.message}`);
    return [];
  }
}

export async function getLanguages(owner, repo) {
  try {
    const client = getGitHubClient();
    const { data } = await client.get(`/repos/${owner}/${repo}/languages`);
    
    // Convert to percentages
    const total = Object.values(data).reduce((sum, val) => sum + val, 0);
    const percentages = {};
    for (const [lang, bytes] of Object.entries(data)) {
      percentages[lang] = ((bytes / total) * 100).toFixed(1) + '%';
    }
    
    return { raw: data, percentages };
  } catch (err) {
    logger.warn(`Failed to fetch languages: ${err.message}`);
    return {};
  }
}

// ─────────────────────────────────────────────
//  Intelligence Engines (Commits & PRs)
// ─────────────────────────────────────────────

/**
 * Fetches up to 1000 commits and derives ownership, frequency, temporal heatmap, and volatility.
 */
export async function getCommitIntelligence(owner, repo) {
  const client = getGitHubClient();
  let commits = [];
  let page = 1;
  const maxCommits = 1000;
  
  try {
    // We only fetch enough commits to get a good sense of volatility/ownership
    while (commits.length < maxCommits) {
      const { data } = await client.get(`/repos/${owner}/${repo}/commits`, {
        params: { per_page: 100, page },
      });
      if (data.length === 0) break;
      
      // For ownership/volatility, we need the files changed. The list endpoint doesn't return full files,
      // but waiting to fetch files per commit for 1000 commits is too slow.
      // Alternatively, the GitHub API does return a few files in the commit object if accessed individually, 
      // but the list endpoint omits them.
      // Wait, if we can't get files efficiently, we might need a different approach or fetch top commits fully.
      // Actually, since we need files per commit, we can fetch individual commits, but let's cap it at 100 to save limits.
      commits.push(...data);
      if (data.length < 100) break;
      page++;
      
      // Limit to 2 pages (200 commits) for the detailed file fetching to avoid rate limits
      if (page > 2) break; 
    }
  } catch (err) {
    logger.warn(`Failed to fetch commits: ${err.message}`);
  }

  const ownership = {};
  const heatmap = {}; // "YYYY-MM-WW" -> count
  const fileFrequency = {};
  
  // We will fetch file changes for the most recent 100 commits to compute volatility and ownership
  // To avoid blasting the API, we use Promise.all in batches of 10
  const detailedCommits = [];
  for (let i = 0; i < Math.min(commits.length, 100); i += 10) {
    const batch = commits.slice(i, i + 10);
    const batchPromises = batch.map((c) =>
      client.get(`/repos/${owner}/${repo}/commits/${c.sha}`).catch(() => null)
    );
    const results = await Promise.all(batchPromises);
    detailedCommits.push(...results.filter(Boolean).map(r => r.data));
  }
  
  detailedCommits.forEach((commit) => {
    // Heatmap calculation
    const dateStr = commit.commit.author.date;
    const date = new Date(dateStr);
    // Rough week grouping: YYYY-WW
    const year = date.getFullYear();
    // Week number calculation (approx)
    const firstDay = new Date(year, 0, 1);
    const days = Math.floor((date - firstDay) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
    
    heatmap[weekKey] = (heatmap[weekKey] || 0) + 1;
    
    const author = commit.author?.login || commit.commit.author.name || 'unknown';
    
    // Process files
    if (commit.files) {
      commit.files.forEach((f) => {
        const filePath = f.filename;
        
        // Frequency
        fileFrequency[filePath] = (fileFrequency[filePath] || 0) + 1;
        
        // Ownership
        if (!ownership[filePath]) {
          ownership[filePath] = { counts: {}, total: 0 };
        }
        ownership[filePath].counts[author] = (ownership[filePath].counts[author] || 0) + 1;
        ownership[filePath].total++;
      });
    }
  });

  // Finalise ownership map
  const finalOwnership = {};
  for (const [filePath, data] of Object.entries(ownership)) {
    let topContributor = null;
    let maxCount = 0;
    const contributorsList = [];
    
    for (const [author, count] of Object.entries(data.counts)) {
      contributorsList.push({ author, count });
      if (count > maxCount) {
        maxCount = count;
        topContributor = author;
      }
    }
    
    finalOwnership[filePath] = {
      topContributor,
      contributions: maxCount,
      contributors: contributorsList.sort((a, b) => b.count - a.count),
    };
  }
  
  // Volatility: high frequency in the last 100 commits
  const volatility = {};
  for (const [filePath, freq] of Object.entries(fileFrequency)) {
    if (freq > 3) {
      // Arbitrary threshold for volatility
      volatility[filePath] = freq;
    }
  }

  // Convert heatmap to array for frontend
  const commitsPerWeek = Object.entries(heatmap)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return {
    ownership: finalOwnership,
    activity: {
      commitsPerWeek,
      volatility,
    },
    fileFrequency,
  };
}

export async function getPRIntelligence(owner, repo) {
  const client = getGitHubClient();
  let prs = [];
  let page = 1;
  const maxPRs = 100;
  
  try {
    while (prs.length < maxPRs) {
      const { data } = await client.get(`/repos/${owner}/${repo}/pulls`, {
        params: { state: 'all', per_page: 100, page },
      });
      if (data.length === 0) break;
      prs.push(...data);
      if (data.length < 100) break;
      page++;
    }
  } catch (err) {
    logger.warn(`Failed to fetch PRs: ${err.message}`);
    return { total: 0, churnFiles: {} };
  }

  // To compute PR churn, we need files for the PRs. 
  // We'll limit to the last 20 PRs to save API calls.
  const recentPRs = prs.slice(0, 20);
  const prChurn = {};
  
  const batchPromises = recentPRs.map((pr) =>
    client.get(`/repos/${owner}/${repo}/pulls/${pr.number}/files`).catch(() => null)
  );
  
  try {
    const results = await Promise.all(batchPromises);
    results.forEach((res) => {
      if (res && res.data) {
        res.data.forEach((file) => {
          prChurn[file.filename] = (prChurn[file.filename] || 0) + 1;
        });
      }
    });
  } catch (err) {
    logger.warn(`Failed to fetch PR files: ${err.message}`);
  }
  
  // Sort churn files
  const churnList = Object.entries(prChurn)
    .map(([file, count]) => ({ file, churn: count }))
    .sort((a, b) => b.churn - a.churn);

  return {
    total: prs.length,
    churnMap: prChurn,
    churnFiles: churnList.slice(0, 50), // top 50 churned files
  };
}

// ─────────────────────────────────────────────
//  Enhanced Hotspot Engine
// ─────────────────────────────────────────────

/**
 * Computes an enhanced hotspot score combining Git CLI hotspots, API commit data, and PR churn.
 * 
 * Formula:
 * enhancedHotspotScore = (commitFrequency * 0.4) + (prChurn * 0.3) + (recency * 0.3)
 */
export function computeEnhancedHotspots(cliHotspots, apiFrequency, prChurnMap) {
  const merged = {};
  
  // Collect all unique files
  const allFiles = new Set([
    ...Object.keys(cliHotspots),
    ...Object.keys(apiFrequency),
    ...Object.keys(prChurnMap),
  ]);

  // Find max values for normalization
  const maxCli = Math.max(1, ...Object.values(cliHotspots));
  const maxApi = Math.max(1, ...Object.values(apiFrequency));
  const maxPr = Math.max(1, ...Object.values(prChurnMap));

  for (const file of allFiles) {
    const cliScore = (cliHotspots[file] || 0) / maxCli;
    const apiScore = (apiFrequency[file] || 0) / maxApi;
    const prScore = (prChurnMap[file] || 0) / maxPr;
    
    // Combine CLI and API frequency for the "commitFrequency" component
    const freqFactor = (cliScore + apiScore) / 2;
    // We treat the apiScore as a proxy for recency since it's the last 100 commits
    const recencyFactor = apiScore; 
    
    const score = (freqFactor * 0.4) + (prScore * 0.3) + (recencyFactor * 0.3);
    
    // Scale 0-100
    merged[file] = Math.round(score * 100);
  }
  
  // Sort descending
  return Object.entries(merged)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [key, val]) => {
      acc[key] = val;
      return acc;
    }, {});
}
