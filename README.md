# CodeAtlas

**CodeAtlas** is an AST-powered codebase analysis engine and intelligence layer. It takes a GitHub repository URL, clones it, parses its JavaScript/TypeScript structure using [Tree-sitter](https://tree-sitter.github.io/tree-sitter/), and overlays it with rich GitHub activity data and OpenAI-powered explanations.

CodeAtlas is designed to behave like a mini GitHub analytics engine, answering questions like:
* **Structure:** What are the dependencies between files and functions?
* **Behavior:** Which functions call which other functions?
* **Risk:** What are the hotspots in the codebase based on change frequency and PR churn?
* **Ownership:** Who owns what files based on commit history?
* **Activity:** How is the repository evolving over time?

---

## 🚀 Features

* **Abstract Syntax Tree (AST) Parsing:** Uses `tree-sitter` to parse code and extract functions, imports, and cross-file function calls.
* **Function-Level Dependency Graph:** Builds a comprehensive node/edge graph mapping out internal and external dependencies.
* **GitHub Intelligence Layer:** 
  * Integrates with the GitHub REST API (v3) to pull repository metadata, contributor stats, languages, commits, and pull requests.
  * Constructs an **ownership map** to identify the top contributor for every file.
  * Tracks temporal activity (commits per week) and file volatility.
* **Risk Scoring & Enhanced Hotspots:** Computes an intelligent risk score (0-100) per node based on degree centrality, file size (LOC), and a custom hotspot score (combining local Git CLI history, API commit frequency, and PR churn).
* **AI Explainer Endpoint:** Uses OpenAI's `gpt-4o-mini` to automatically explain what a function does, how it works, why it exists, and any associated risks.

---

## 📂 Architecture

The backend is built with **Node.js (ESM modules)** and **Express.js**.

```text
backend/
├── src/
│   ├── index.js                     # Express server & middleware
│   ├── routes/
│   │   └── analyze.routes.js        # API route definitions
│   ├── controllers/
│   │   └── analyze.controller.js    # Pipeline orchestration & response mapping
│   ├── services/
│   │   ├── ai.service.js            # OpenAI integration & caching
│   │   ├── file.service.js          # Recursive JS/TS file scanner
│   │   ├── git.service.js           # Local Git CLI operations
│   │   ├── github.service.js        # GitHub REST API wrappers & intelligence
│   │   ├── graph.service.js         # Graph builder & Risk Scoring Engine
│   │   ├── parser.service.js        # Tree-sitter AST parsing
│   │   └── repo.service.js          # Clone/cleanup operations
│   └── utils/
│       └── logger.js                # Coloured structured logger
├── start.sh                         # App startup script
└── package.json                     
```

---

## 🛠 Prerequisites

* **Node.js** (v18 or higher recommended)
* **Git** installed on the host machine.

---

## ⚙️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ChinmayyK/CodeAtlas.git
   cd CodeAtlas/backend
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the `backend/` directory, or export these directly:
   ```bash
   export GITHUB_TOKEN="your_github_personal_access_token"
   export OPENAI_API_KEY="your_openai_api_key"
   ```
   *Note: If `GITHUB_TOKEN` is omitted, strict unauthenticated API rate limits will apply. If `OPENAI_API_KEY` is omitted, the AI explainer will return a graceful fallback message.*

3. **Start the Application:**
   Use the provided startup script. It will automatically install dependencies and start the Express server on port `5000`.
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
   *(To run in production mode, use `./start.sh --prod`)*

---

## 📡 API Reference

### 1. Health Check
`GET /api/health`
Returns the server uptime and status.

### 2. Analyze GitHub Repository
`POST /api/analyze/github`

**Request:**
```json
{
  "repoUrl": "https://github.com/expressjs/cors"
}
```

**Response Overview:**
Returns a massive intelligence payload including:
* `nodes`: Array of files and functions, enriched with `owner` and `risk` score.
* `edges`: Directed edges of type `contains`, `import`, and `calls` (with call weights).
* `hotspots`: Custom 0-100 scale representing churn.
* `contributors`: List of active contributors.
* `ownership`: File-by-file breakdown of authors and top contributors.
* `repo`: Metadata (stars, forks, languages).
* `activity`: Weekly commits and highly volatile files.
* `pullRequests`: PR statistics and top churned files from recent PRs.
* `meta`: Pipeline execution metrics.

### 3. AI Function Explainer
`POST /api/explain`

**Request:**
```json
{
  "repoUrl": "https://github.com/expressjs/cors",
  "nodeId": "lib/index.js:cors",
  "dependencies": ["configureOrigin", "configureMethods"]
}
```

**Response:**
```json
{
  "explanation": "1. What this function does...\n2. How it works...\n3. Why it exists...\n4. Risks & Complexity...",
  "summary": "This function is responsible for...",
  "functionName": "cors",
  "dependencies": [
    "configureOrigin",
    "configureMethods"
  ]
}
```
*(Results are cached in-memory for 30 minutes to reduce latency and API costs.)*

---

## ⚠️ Important Notes
* **Temporary Storage:** The backend performs a shallow clone of the target repository into a `tmp/` folder. This is deleted immediately after analysis to keep the system stateless.
* **Size Limits:** Repositories over `500MB` are automatically rejected.
* **Pagination:** GitHub API calls are paginated (max 1000 commits, max 100 PRs) to respect API rate limits while still generating meaningful intelligence.
