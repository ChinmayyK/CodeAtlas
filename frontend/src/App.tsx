import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

type NodeKind = 'module' | 'function' | 'service' | 'data';
type ViewMode = 'map' | 'trace' | 'risk';

type AtlasNode = d3.SimulationNodeDatum & {
  id: string;
  label: string;
  path: string;
  kind: NodeKind;
  owner: string;
  risk: number;
  churn: number;
  loc: number;
  summary: string;
  calls: string[];
  callers: string[];
};

type AtlasLink = d3.SimulationLinkDatum<AtlasNode> & {
  source: string | AtlasNode;
  target: string | AtlasNode;
  weight: number;
  relation: 'imports' | 'calls' | 'writes' | 'reads';
};

const repositoryImage =
  'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=900&q=80';

const nodes: AtlasNode[] = [
  {
    id: 'ingest',
    label: 'scanRepository',
    path: 'src/indexer/scanRepository.ts',
    kind: 'service',
    owner: 'Platform',
    risk: 42,
    churn: 18,
    loc: 284,
    summary:
      'Walks the repository tree, applies ignore rules, and builds the first inventory of files that can be parsed safely.',
    calls: ['tree-sitter', 'git-log', 'graph-store'],
    callers: ['cli-entry'],
  },
  {
    id: 'tree-sitter',
    label: 'parseAst',
    path: 'src/parser/treeSitter.ts',
    kind: 'function',
    owner: 'Language',
    risk: 68,
    churn: 31,
    loc: 412,
    summary:
      'Normalizes syntax trees across TypeScript, Python, and Go so downstream analysis can work from one internal shape.',
    calls: ['symbol-index', 'dependency-resolver'],
    callers: ['ingest'],
  },
  {
    id: 'symbol-index',
    label: 'symbolIndex',
    path: 'src/parser/symbolIndex.ts',
    kind: 'module',
    owner: 'Language',
    risk: 54,
    churn: 23,
    loc: 366,
    summary:
      'Tracks exported functions, local declarations, and unresolved references before dependency resolution begins.',
    calls: ['dependency-resolver'],
    callers: ['tree-sitter', 'flow-trace'],
  },
  {
    id: 'dependency-resolver',
    label: 'resolveDependencies',
    path: 'src/graph/resolveDependencies.ts',
    kind: 'function',
    owner: 'Graph',
    risk: 79,
    churn: 44,
    loc: 521,
    summary:
      'Connects imports, function calls, and file ownership into the relationship graph used by the map.',
    calls: ['graph-store', 'hotspot-score'],
    callers: ['tree-sitter', 'symbol-index'],
  },
  {
    id: 'graph-store',
    label: 'graphStore',
    path: 'src/graph/store.ts',
    kind: 'data',
    owner: 'Graph',
    risk: 47,
    churn: 16,
    loc: 238,
    summary:
      'Persists nodes, edges, scan metadata, and cluster positions so the graph stays stable between sessions.',
    calls: ['api-routes'],
    callers: ['ingest', 'dependency-resolver', 'hotspot-score'],
  },
  {
    id: 'git-log',
    label: 'readGitHistory',
    path: 'src/history/readGitHistory.ts',
    kind: 'service',
    owner: 'Insights',
    risk: 61,
    churn: 35,
    loc: 319,
    summary:
      'Collects commit frequency, author spread, and recency signals from the Git CLI without sending repository code anywhere.',
    calls: ['hotspot-score'],
    callers: ['ingest'],
  },
  {
    id: 'hotspot-score',
    label: 'scoreHotspots',
    path: 'src/insights/scoreHotspots.ts',
    kind: 'function',
    owner: 'Insights',
    risk: 88,
    churn: 53,
    loc: 274,
    summary:
      'Combines churn, centrality, and ownership signals to rank files that deserve careful review before changes land.',
    calls: ['graph-store', 'explainer'],
    callers: ['git-log', 'dependency-resolver'],
  },
  {
    id: 'flow-trace',
    label: 'traceFunctionFlow',
    path: 'src/trace/traceFunctionFlow.ts',
    kind: 'function',
    owner: 'Graph',
    risk: 72,
    churn: 29,
    loc: 447,
    summary:
      'Builds incoming and outgoing call paths for a selected function, then trims the result into an explorable route.',
    calls: ['symbol-index', 'api-routes'],
    callers: ['api-routes'],
  },
  {
    id: 'explainer',
    label: 'explainCluster',
    path: 'src/ai/explainCluster.ts',
    kind: 'service',
    owner: 'AI',
    risk: 63,
    churn: 21,
    loc: 341,
    summary:
      'Creates plain-language module notes from selected files while keeping references grounded in parsed symbols and paths.',
    calls: ['api-routes'],
    callers: ['hotspot-score', 'api-routes'],
  },
  {
    id: 'api-routes',
    label: 'atlasRoutes',
    path: 'src/server/routes.ts',
    kind: 'module',
    owner: 'API',
    risk: 57,
    churn: 27,
    loc: 489,
    summary:
      'Serves scans, graph windows, hotspot reports, traces, and explanations to the frontend.',
    calls: ['flow-trace', 'explainer'],
    callers: ['graph-store', 'flow-trace', 'explainer'],
  },
  {
    id: 'cli-entry',
    label: 'codeatlas scan',
    path: 'bin/codeatlas.ts',
    kind: 'module',
    owner: 'CLI',
    risk: 34,
    churn: 12,
    loc: 196,
    summary:
      'Starts local analysis from the command line and streams scan progress back to the web client.',
    calls: ['ingest'],
    callers: [],
  },
];

const links: AtlasLink[] = [
  { source: 'cli-entry', target: 'ingest', weight: 2, relation: 'calls' },
  { source: 'ingest', target: 'tree-sitter', weight: 4, relation: 'calls' },
  { source: 'ingest', target: 'git-log', weight: 2, relation: 'calls' },
  { source: 'ingest', target: 'graph-store', weight: 2, relation: 'writes' },
  { source: 'tree-sitter', target: 'symbol-index', weight: 4, relation: 'writes' },
  { source: 'tree-sitter', target: 'dependency-resolver', weight: 3, relation: 'calls' },
  { source: 'symbol-index', target: 'dependency-resolver', weight: 4, relation: 'reads' },
  { source: 'dependency-resolver', target: 'graph-store', weight: 5, relation: 'writes' },
  { source: 'dependency-resolver', target: 'hotspot-score', weight: 2, relation: 'calls' },
  { source: 'git-log', target: 'hotspot-score', weight: 4, relation: 'calls' },
  { source: 'hotspot-score', target: 'graph-store', weight: 3, relation: 'writes' },
  { source: 'hotspot-score', target: 'explainer', weight: 1, relation: 'calls' },
  { source: 'flow-trace', target: 'symbol-index', weight: 3, relation: 'reads' },
  { source: 'flow-trace', target: 'api-routes', weight: 2, relation: 'calls' },
  { source: 'graph-store', target: 'api-routes', weight: 4, relation: 'reads' },
  { source: 'api-routes', target: 'flow-trace', weight: 3, relation: 'calls' },
  { source: 'api-routes', target: 'explainer', weight: 3, relation: 'calls' },
  { source: 'explainer', target: 'api-routes', weight: 2, relation: 'calls' },
];

const scanEvents = [
  { time: '09:41', label: 'Parsed 2,418 files', tone: 'good' },
  { time: '09:42', label: 'Mapped 18,906 symbols', tone: 'good' },
  { time: '09:44', label: 'Detected 7 hotspot clusters', tone: 'warn' },
  { time: '09:45', label: 'Generated onboarding brief', tone: 'good' },
];

const riskRows = [...nodes].sort((a, b) => b.risk - a.risk).slice(0, 5);

const kindColor: Record<NodeKind, string> = {
  module: '#27445d',
  function: '#007c70',
  service: '#7b4d9b',
  data: '#5f6f2d',
};

const relationColor: Record<AtlasLink['relation'], string> = {
  imports: '#8a96a6',
  calls: '#0d8c7c',
  writes: '#bc3f3f',
  reads: '#7f8f2d',
};

function getLinkedIds(selectedId: string) {
  const linked = new Set<string>([selectedId]);

  links.forEach((link) => {
    const source = typeof link.source === 'string' ? link.source : link.source.id;
    const target = typeof link.target === 'string' ? link.target : link.target.id;

    if (source === selectedId) linked.add(target);
    if (target === selectedId) linked.add(source);
  });

  return linked;
}

function nodeById(id: string) {
  return nodes.find((node) => node.id === id) ?? nodes[0];
}

function GraphCanvas({
  selectedId,
  onSelect,
  viewMode,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  viewMode: ViewMode;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 900;
    const height = svgRef.current.clientHeight || 620;
    const compact = width < 620;
    const linkedIds = getLinkedIds(selectedId);
    const radius = Math.min(width, height) * (compact ? 0.24 : 0.32);
    const graphNodes: AtlasNode[] = nodes.map((node, index) => {
      const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      };
    });
    const graphLinks = links.map((link) => ({ ...link }));

    const defs = svg.append('defs');
    const grid = defs
      .append('pattern')
      .attr('id', 'atlas-grid')
      .attr('width', 28)
      .attr('height', 28)
      .attr('patternUnits', 'userSpaceOnUse');

    grid
      .append('path')
      .attr('d', 'M 28 0 L 0 0 0 28')
      .attr('fill', 'none')
      .attr('stroke', '#d8dee3')
      .attr('stroke-width', 0.7);

    svg
      .append('rect')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('fill', 'url(#atlas-grid)')
      .attr('opacity', 0.45);

    const viewport = svg.append('g').attr('class', 'graph-viewport');
    const linkLayer = viewport.append('g').attr('class', 'links');
    const nodeLayer = viewport.append('g').attr('class', 'nodes');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.62, 2.6])
      .on('zoom', (event) => {
        viewport.attr('transform', event.transform);
      });

    svg.call(zoom);

    const simulation = d3
      .forceSimulation<AtlasNode>(graphNodes)
      .force(
        'link',
        d3
          .forceLink<AtlasNode, AtlasLink>(graphLinks)
          .id((node) => node.id)
          .distance((link) =>
            compact ? 74 + (5 - link.weight) * 10 : 138 + (5 - link.weight) * 18,
          )
          .strength(compact ? 0.34 : 0.24),
      )
      .force('charge', d3.forceManyBody().strength(compact ? -430 : -1420))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collision',
        d3.forceCollide<AtlasNode>().radius((node) =>
          compact ? 25 + node.risk / 5.8 : 42 + node.risk / 3.2,
        ),
      )
      .force('x', d3.forceX<AtlasNode>(width / 2).strength(compact ? 0.09 : 0.02))
      .force('y', d3.forceY<AtlasNode>(height / 2).strength(compact ? 0.09 : 0.026));

    const link = linkLayer
      .selectAll<SVGLineElement, AtlasLink>('line')
      .data(graphLinks)
      .join('line')
      .attr('stroke', (edge) => relationColor[edge.relation])
      .attr('stroke-width', (edge) => Math.max(1.2, edge.weight * 0.68))
      .attr('stroke-linecap', 'round')
      .attr('opacity', (edge) => {
        const source = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
        return linkedIds.has(source) && linkedIds.has(target) ? 0.8 : 0.22;
      });

    const node = nodeLayer
      .selectAll<SVGGElement, AtlasNode>('g')
      .data(graphNodes)
      .join('g')
      .attr('class', 'graph-node')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, AtlasNode>()
          .on('start', (event, draggedNode) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            draggedNode.fx = draggedNode.x;
            draggedNode.fy = draggedNode.y;
          })
          .on('drag', (event, draggedNode) => {
            draggedNode.fx = event.x;
            draggedNode.fy = event.y;
          })
          .on('end', (event, draggedNode) => {
            if (!event.active) simulation.alphaTarget(0);
            draggedNode.fx = undefined;
            draggedNode.fy = undefined;
          }),
      )
      .on('click', (_, clickedNode) => onSelect(clickedNode.id))
      .on('keydown', (event, clickedNode) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(clickedNode.id);
        }
      });

    node
      .append('circle')
      .attr('r', (datum) => (viewMode === 'risk' ? 12 + datum.risk / 4.5 : 16 + datum.loc / 100))
      .attr('fill', (datum) => kindColor[datum.kind])
      .attr('stroke', (datum) => (datum.id === selectedId ? '#111417' : '#f6f8f8'))
      .attr('stroke-width', (datum) => (datum.id === selectedId ? 4 : 2))
      .attr('opacity', (datum) => (linkedIds.has(datum.id) ? 1 : 0.5));

    node
      .append('circle')
      .attr('r', (datum) => (viewMode === 'risk' ? 17 + datum.risk / 4.3 : 23 + datum.loc / 105))
      .attr('fill', 'none')
      .attr('stroke', (datum) => (datum.risk > 75 ? '#bc3f3f' : datum.risk > 58 ? '#9b822c' : '#95a1a9'))
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', (datum) => (datum.churn > 30 ? '4 5' : '0'))
      .attr('opacity', (datum) => (linkedIds.has(datum.id) ? 0.75 : 0.2));

    node
      .append('text')
      .text((datum) => datum.label)
      .attr('x', 0)
      .attr('y', (datum) => (viewMode === 'risk' ? 33 + datum.risk / 7 : 38 + datum.loc / 140))
      .attr('text-anchor', 'middle')
      .attr('fill', '#182026')
      .attr('font-size', 11)
      .attr('font-weight', 700)
      .attr('paint-order', 'stroke')
      .attr('stroke', '#f6f8f8')
      .attr('stroke-width', 4)
      .attr('stroke-linejoin', 'round')
      .attr('opacity', (datum) => (linkedIds.has(datum.id) ? 1 : 0.45));

    node.append('title').text((datum) => `${datum.path}\nRisk ${datum.risk}/100`);

    simulation.on('tick', () => {
      const marginX = compact ? 62 : 48;
      const marginY = compact ? 52 : 42;

      graphNodes.forEach((graphNode) => {
        graphNode.x = Math.max(marginX, Math.min(width - marginX, graphNode.x ?? width / 2));
        graphNode.y = Math.max(marginY, Math.min(height - marginY, graphNode.y ?? height / 2));
      });

      link
        .attr('x1', (datum) => (datum.source as AtlasNode).x ?? 0)
        .attr('y1', (datum) => (datum.source as AtlasNode).y ?? 0)
        .attr('x2', (datum) => (datum.target as AtlasNode).x ?? 0)
        .attr('y2', (datum) => (datum.target as AtlasNode).y ?? 0);

      node.attr('transform', (datum) => `translate(${datum.x ?? 0},${datum.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [selectedId, onSelect, viewMode]);

  return <svg ref={svgRef} className="dependency-graph" aria-label="Interactive dependency graph" />;
}

function RiskBar({ value }: { value: number }) {
  return (
    <div className="risk-bar" aria-label={`Risk score ${value}`}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function App() {
  const [selectedId, setSelectedId] = useState('dependency-resolver');
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const selectedNode = useMemo(() => nodeById(selectedId), [selectedId]);
  const linkedIds = useMemo(() => getLinkedIds(selectedId), [selectedId]);
  const callers = selectedNode.callers.map(nodeById);
  const calls = selectedNode.calls.map(nodeById);

  const health = Math.round(
    nodes.reduce((total, node) => total + (100 - node.risk), 0) / nodes.length,
  );

  return (
    <main className="atlas-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="CodeAtlas workspace">
          <span className="brand-mark">CA</span>
          <span>
            <strong>CodeAtlas</strong>
            <small>northstar-api / main</small>
          </span>
        </a>

        <nav className="topnav" aria-label="Primary">
          <a href="#workspace">Map</a>
          <a href="#hotspots">Hotspots</a>
          <a href="#briefing">Briefing</a>
          <a href="#pipeline">Pipeline</a>
        </nav>

        <div className="topbar-actions">
          <button className="ghost-button">Share readout</button>
          <button className="primary-button">Scan repo</button>
        </div>
      </header>

      <section className="workspace" id="workspace" aria-label="CodeAtlas workspace">
        <aside className="sidebar scan-panel" aria-label="Repository scan">
          <div className="section-kicker">Current Scan</div>
          <h1>northstar-api</h1>
          <p className="lead">
            2,418 files mapped across services, workers, auth, billing, and internal tooling.
          </p>

          <div className="scan-score">
            <div>
              <strong>{health}</strong>
              <span>health</span>
            </div>
            <RiskBar value={100 - health} />
          </div>

          <div className="quick-stats" aria-label="Repository stats">
            <div>
              <strong>18.9k</strong>
              <span>symbols</span>
            </div>
            <div>
              <strong>742</strong>
              <span>edges</span>
            </div>
            <div>
              <strong>7</strong>
              <span>hotspots</span>
            </div>
            <div>
              <strong>43s</strong>
              <span>last scan</span>
            </div>
          </div>

          <div className="mode-stack" role="group" aria-label="Graph view mode">
            {[
              { id: 'map', label: 'System map', detail: 'Files, functions, imports' },
              { id: 'trace', label: 'Function trace', detail: 'Callers and callees' },
              { id: 'risk', label: 'Risk lens', detail: 'Churn and centrality' },
            ].map((item) => (
              <button
                className={viewMode === item.id ? 'mode-card active' : 'mode-card'}
                key={item.id}
                onClick={() => setViewMode(item.id as ViewMode)}
              >
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>

          <ol className="event-list" aria-label="Scan events">
            {scanEvents.map((event) => (
              <li key={`${event.time}-${event.label}`} className={event.tone}>
                <span>{event.time}</span>
                <p>{event.label}</p>
              </li>
            ))}
          </ol>
        </aside>

        <section className="map-stage" aria-label="Dependency graph explorer">
          <div className="stage-toolbar">
            <div>
              <div className="section-kicker">Interactive Dependency Graph</div>
              <h2>Click any node to trace the flow.</h2>
            </div>
            <div className="toolbar-actions">
              <button>Depth 2</button>
              <button>Group by owner</button>
              <button>Export PNG</button>
            </div>
          </div>

          <div className="graph-wrap">
            <GraphCanvas selectedId={selectedId} onSelect={setSelectedId} viewMode={viewMode} />
            <div className="graph-legend" aria-label="Graph legend">
              <span><i className="legend-module" />Module</span>
              <span><i className="legend-function" />Function</span>
              <span><i className="legend-service" />Service</span>
              <span><i className="legend-data" />Data</span>
            </div>
          </div>
        </section>

        <aside className="sidebar detail-panel" aria-label="Selected code unit">
          <div className="section-kicker">Selected</div>
          <h2>{selectedNode.label}</h2>
          <code>{selectedNode.path}</code>

          <div className="owner-row">
            <span>{selectedNode.owner}</span>
            <span>{selectedNode.kind}</span>
          </div>

          <div className="risk-card">
            <div>
              <span>Risk score</span>
              <strong>{selectedNode.risk}</strong>
            </div>
            <RiskBar value={selectedNode.risk} />
            <p>{selectedNode.churn} changes in the last 90 days · {selectedNode.loc} LOC</p>
          </div>

          <section className="explainer-box" aria-label="AI code explainer">
            <div className="section-kicker">Code Explainer</div>
            <p>{selectedNode.summary}</p>
          </section>

          <section className="flow-columns" aria-label="Function flow">
            <div>
              <h3>Called by</h3>
              {callers.length ? (
                callers.map((node) => (
                  <button key={node.id} onClick={() => setSelectedId(node.id)}>
                    {node.label}
                  </button>
                ))
              ) : (
                <p>Entry point</p>
              )}
            </div>
            <div>
              <h3>Calls</h3>
              {calls.map((node) => (
                <button key={node.id} onClick={() => setSelectedId(node.id)}>
                  {node.label}
                </button>
              ))}
            </div>
          </section>

          <div className="selected-links">
            <span>{linkedIds.size - 1} direct relationships</span>
            <span>{selectedNode.churn > 30 ? 'watch closely' : 'stable enough'}</span>
          </div>
        </aside>
      </section>

      <section className="hotspots-band" id="hotspots">
        <div className="band-heading">
          <div>
            <div className="section-kicker">Hotspot Analysis</div>
            <h2>Where change deserves extra attention.</h2>
          </div>
          <p>
            Risk is calculated from churn, graph centrality, file size, and ownership spread.
          </p>
        </div>

        <div className="hotspot-grid">
          {riskRows.map((node, index) => (
            <article className="hotspot-card" key={node.id}>
              <span className="rank">0{index + 1}</span>
              <div>
                <h3>{node.label}</h3>
                <p>{node.path}</p>
              </div>
              <RiskBar value={node.risk} />
              <button onClick={() => setSelectedId(node.id)}>Open in map</button>
            </article>
          ))}
        </div>
      </section>

      <section className="briefing-band" id="briefing">
        <div className="briefing-copy">
          <div className="section-kicker">Onboarding Brief</div>
          <h2>Start with the files that explain the system.</h2>
          <p>
            CodeAtlas keeps explanations tied to concrete paths, callers, and changed areas, so
            a new teammate can follow the architecture without waiting for tribal knowledge.
          </p>
          <div className="briefing-list">
            <span>1. Read graph/store.ts before routes.ts</span>
            <span>2. Review scoreHotspots before changing parser output</span>
            <span>3. Treat resolveDependencies as a shared contract</span>
          </div>
        </div>
        <figure className="repo-photo">
          <img src={repositoryImage} alt="A developer reviewing code on a laptop" />
          <figcaption>Local analysis. Grounded summaries. No repository code leaves the machine.</figcaption>
        </figure>
      </section>

      <section className="pipeline-band" id="pipeline">
        <div className="band-heading">
          <div>
            <div className="section-kicker">Analysis Pipeline</div>
            <h2>From repository to working map.</h2>
          </div>
        </div>

        <div className="pipeline">
          {[
            ['Tree-sitter', 'Parse files into syntax trees with language-specific adapters.'],
            ['Symbol graph', 'Resolve functions, imports, exports, and cross-file relationships.'],
            ['Git history', 'Score churn and instability from commit behavior.'],
            ['Explainer', 'Generate plain-English summaries from selected clusters.'],
          ].map(([title, text]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
