import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { LandingPage } from './LandingPage';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

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
  summary?: string;
  calls: string[];
  callers: string[];
  focusLevel?: number; // 0 = selected, 1 = direct neighbor, 2 = 2-hop, 3 = hidden/other
  isCollapsedFile?: boolean;
};

type AtlasLink = d3.SimulationLinkDatum<AtlasNode> & {
  source: string | AtlasNode;
  target: string | AtlasNode;
  weight: number;
  relation: 'imports' | 'calls' | 'writes' | 'reads' | 'contains' | string;
};

interface ApiNode {
  id: string;
  label: string;
  type: string;
  file: string;
  owner?: string;
  risk?: number;
}

interface ApiEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
}

interface ApiData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  hotspots: Record<string, number>;
  contributors: any[];
  ownership: Record<string, { topContributor: string, contributions: number }>;
  repo: {
    name: string;
    stars: number;
    forks: number;
    issues: number;
    language: string;
    size: number;
    languages: Record<string, string>;
  };
  activity: {
    commitsPerWeek: { week: string; count: number }[];
    volatility: Record<string, number>;
  };
  pullRequests: any;
  meta: {
    totalFiles: number;
    totalFunctions: number;
    totalCalls: number;
    analysisTimeMs: number;
  };
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const repositoryImage = 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=900&q=80';

// ─────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────

const kindColor: Record<string, string> = {
  module: '#27445d',
  function: '#007c70',
  service: '#7b4d9b',
  data: '#5f6f2d',
  external: '#95a1a9',
};

const relationColor: Record<string, string> = {
  import: '#8a96a6',
  calls: '#0d8c7c',
  contains: '#5f6f2d',
  writes: '#bc3f3f',
  reads: '#7f8f2d',
};

const ownerColorScale = d3.scaleOrdinal(d3.schemeCategory10);

function GraphCanvas({
  selectedId,
  onSelect,
  viewMode,
  nodes,
  links,
  groupByOwner,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  viewMode: ViewMode;
  nodes: AtlasNode[];
  links: AtlasLink[];
  groupByOwner: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 900;
    const height = svgRef.current.clientHeight || 620;
    const compact = width < 620;
    
    // Create local copies for D3 simulation
    const graphNodes: AtlasNode[] = nodes.map((node) => ({
      ...node,
      x: width / 2 + (Math.random() - 0.5) * 100,
      y: height / 2 + (Math.random() - 0.5) * 100,
    }));
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
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        viewport.attr('transform', event.transform);
      });

    svg.call(zoom);

    const baseDistance = compact ? 50 : 80;

    const simulation = d3
      .forceSimulation<AtlasNode>(graphNodes)
      .force(
        'link',
        d3
          .forceLink<AtlasNode, AtlasLink>(graphLinks)
          .id((node) => node.id)
          .distance((link) => {
            if (link.relation === 'contains') return 15;
            return baseDistance + (5 - (link.weight || 1)) * 10;
          })
          .strength(0.5)
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collision',
        d3.forceCollide<AtlasNode>().radius((node) => {
          const baseR = node.focusLevel === 0 ? 30 : node.focusLevel === 1 ? 22 : 16;
          return baseR + (node.risk || 0) / 5;
        })
      )
      .force('x', d3.forceX<AtlasNode>(width / 2).strength(0.08))
      .force('y', d3.forceY<AtlasNode>(height / 2).strength(0.08));

    const link = linkLayer
      .selectAll<SVGLineElement, AtlasLink>('line')
      .data(graphLinks)
      .join('line')
      .attr('stroke', (edge) => relationColor[edge.relation] || '#8a96a6')
      .attr('stroke-width', (edge) => Math.max(1, (edge.weight || 1) * 0.8))
      .attr('stroke-linecap', 'round')
      .attr('opacity', (edge) => {
        const source = edge.source as AtlasNode;
        const target = edge.target as AtlasNode;
        // Fade edges that connect to 2-hop or hidden nodes
        if (source.focusLevel === 2 || target.focusLevel === 2) return 0.2;
        return 0.7;
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
          })
      )
      .on('click', (_, clickedNode) => {
        onSelect(clickedNode.id);
      })
      .on('keydown', (event, clickedNode) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(clickedNode.id);
        }
      });

    // Inner circle
    node
      .append('circle')
      .attr('r', (datum) => {
        let baseR = 16;
        if (selectedId) {
          if (datum.focusLevel === 0) baseR = 28;
          else if (datum.focusLevel === 1) baseR = 20;
          else baseR = 12;
        }
        return baseR;
      })
      .attr('fill', (datum) => {
        if (groupByOwner) return ownerColorScale(datum.owner);
        return kindColor[datum.kind] || kindColor.external;
      })
      .attr('stroke', (datum) => (datum.focusLevel === 0 ? '#ffffff' : '#f6f8f8'))
      .attr('stroke-width', (datum) => (datum.focusLevel === 0 ? 4 : 2))
      .attr('opacity', (datum) => {
        if (!selectedId) return 1;
        if (datum.focusLevel === 0 || datum.focusLevel === 1) return 1;
        if (datum.focusLevel === 2) return 0.4;
        return 0.1;
      });

    // Risk ring
    node
      .append('circle')
      .attr('r', (datum) => {
        let baseR = 22;
        if (selectedId) {
          if (datum.focusLevel === 0) baseR = 36;
          else if (datum.focusLevel === 1) baseR = 26;
          else baseR = 16;
        }
        return baseR + (datum.risk || 0) / 5;
      })
      .attr('fill', 'none')
      .attr('stroke', (datum) => {
        if (datum.risk > 70) return '#bc3f3f'; // Red
        if (datum.risk >= 30) return '#9b822c'; // Yellow
        return '#007c70'; // Green
      })
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', (datum) => (datum.churn > 10 ? '4 5' : '0'))
      .attr('opacity', (datum) => {
        if (!selectedId) return 0.8;
        if (datum.focusLevel === 0 || datum.focusLevel === 1) return 0.9;
        if (datum.focusLevel === 2) return 0.3;
        return 0;
      });

    // Label
    node
      .append('text')
      .text((datum) => datum.label + (datum.isCollapsedFile ? ' (+)' : ''))
      .attr('x', 0)
      .attr('y', (datum) => {
        let baseR = 16;
        if (selectedId) {
          if (datum.focusLevel === 0) baseR = 28;
          else if (datum.focusLevel === 1) baseR = 20;
          else baseR = 12;
        }
        return baseR + 20 + (datum.risk || 0) / 5;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', '#182026')
      .attr('font-size', (datum) => (datum.focusLevel === 0 ? 14 : 11))
      .attr('font-weight', 700)
      .attr('paint-order', 'stroke')
      .attr('stroke', '#f6f8f8')
      .attr('stroke-width', 4)
      .attr('stroke-linejoin', 'round')
      .attr('opacity', (datum) => {
        if (!selectedId) return 1;
        if (datum.focusLevel === 0 || datum.focusLevel === 1) return 1;
        return 0; // hide labels for deep neighbors
      });

    node.append('title').text((datum) => `${datum.path}\nRisk ${datum.risk}/100\nOwner: ${datum.owner}`);

    simulation.on('tick', () => {
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
  }, [selectedId, onSelect, viewMode, nodes, links, groupByOwner]);

  return <svg ref={svgRef} className="dependency-graph" aria-label="Interactive dependency graph" style={{ width: '100%', height: '100%' }} />;
}

function RiskBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, isNaN(value) ? 0 : value));
  let colorClass = 'green';
  if (safeValue > 70) colorClass = 'red';
  else if (safeValue >= 30) colorClass = 'yellow';

  return (
    <div className={`risk-bar ${colorClass}`} aria-label={`Risk score ${safeValue}`}>
      <span style={{ width: `${safeValue}%`, background: colorClass === 'red' ? '#bc3f3f' : colorClass === 'yellow' ? '#9b822c' : '#007c70' }} />
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Application
// ─────────────────────────────────────────────

function App() {
  const [showApp, setShowApp] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appData, setAppData] = useState<ApiData | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [explanation, setExplanation] = useState('');
  const [explainerLoading, setExplainerLoading] = useState(false);

  // ── Intelligent Filters & Clustering State ──
  const [searchQuery, setSearchQuery] = useState('');
  const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
  const [showHighRiskOnly, setShowHighRiskOnly] = useState(false);
  const [groupByOwner, setGroupByOwner] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [showCalls, setShowCalls] = useState(true);
  const [showImports, setShowImports] = useState(true);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('codeatlas_repo');
    if (saved) {
      setRepoUrl(saved);
      setInputUrl(saved);
      handleAnalyze(saved);
      setShowApp(true);
    }
  }, []);

  const handleAnalyze = async (url: string) => {
    if (!url.includes('github.com')) {
      setError('Please enter a valid GitHub URL');
      return;
    }

    setLoading(true);
    setError('');
    setAppData(null);
    setSelectedId(null);
    setSearchQuery('');
    setExpandedModules(new Set());

    try {
      const res = await fetch(`${API_BASE}/api/analyze/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: url }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to analyze repository');
      }

      const data = await res.json();
      setAppData(data);
      localStorage.setItem('codeatlas_repo', url);
      setRepoUrl(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl) handleAnalyze(inputUrl);
  };

  // ── Graph Filtering Engine ──────────────────────
  const { graphNodes, graphLinks, riskRows } = useMemo(() => {
    if (!appData) return { graphNodes: [], graphLinks: [], riskRows: [] };

    // 1. Map raw nodes
    let allNodes = appData.nodes.map((n) => {
      const churn = appData.hotspots?.[n.file] || 0;
      return {
        id: n.id,
        label: n.label,
        path: n.file,
        kind: n.type === 'file' ? 'module' : n.type === 'function' ? 'function' : 'external',
        owner: n.owner || 'Unknown',
        risk: n.risk || 0,
        churn,
        loc: 0,
        calls: [],
        callers: [],
        focusLevel: 3, // default hidden/other
        isCollapsedFile: false,
      } as AtlasNode;
    });

    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    // 2. Map raw links
    let allLinks = appData.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight || 1,
      relation: e.type,
    })) as AtlasLink[];

    // Compute calls/callers for side panel
    allLinks.forEach(e => {
      if (typeof e.source === 'string' && typeof e.target === 'string') {
        nodeMap.get(e.source)?.calls.push(e.target);
        nodeMap.get(e.target)?.callers.push(e.source);
      }
    });

    // 3. Search auto-select
    let activeSelectedId = selectedId;
    if (searchQuery && !selectedId) {
      const match = allNodes.find(n => n.label.toLowerCase().includes(searchQuery.toLowerCase()) || n.path.toLowerCase().includes(searchQuery.toLowerCase()));
      if (match) activeSelectedId = match.id;
    }

    // 4. Clustering (Collapse files)
    // If a file is NOT expanded, its inner functions are hidden, and edges remapped to the file.
    const fileNodes = allNodes.filter(n => n.kind === 'module');
    fileNodes.forEach(f => {
      if (!expandedModules.has(f.id)) {
        f.isCollapsedFile = true;
        const childFuncs = allNodes.filter(n => n.kind === 'function' && n.path === f.path && n.id !== f.id);
        const childIds = new Set(childFuncs.map(c => c.id));
        
        // Remap links
        allLinks = allLinks.map(l => {
          let s = typeof l.source === 'string' ? l.source : l.source.id;
          let t = typeof l.target === 'string' ? l.target : l.target.id;
          
          if (childIds.has(s) && !childIds.has(t)) s = f.id;
          if (childIds.has(t) && !childIds.has(s)) t = f.id;
          
          return { ...l, source: s, target: t };
        });

        // Filter out child nodes
        allNodes = allNodes.filter(n => !childIds.has(n.id));
      } else {
        f.isCollapsedFile = false;
      }
    });

    // 5. Apply Global Filters
    if (showHighRiskOnly) {
      const highRiskIds = new Set(allNodes.filter(n => n.risk > 60).map(n => n.id));
      allNodes = allNodes.filter(n => highRiskIds.has(n.id));
      allLinks = allLinks.filter(l => {
        const s = typeof l.source === 'string' ? l.source : l.source.id;
        const t = typeof l.target === 'string' ? l.target : l.target.id;
        return highRiskIds.has(s) && highRiskIds.has(t);
      });
    }

    if (!showCalls) allLinks = allLinks.filter(l => l.relation !== 'calls');
    if (!showImports) allLinks = allLinks.filter(l => l.relation !== 'import' && l.relation !== 'imports');

    // 6. Focus Mode Logic
    let visibleNodes = allNodes;
    let visibleLinks = allLinks;

    if (activeSelectedId) {
      // Find neighbors
      const hop1 = new Set<string>();
      allLinks.forEach(l => {
        const s = typeof l.source === 'string' ? l.source : l.source.id;
        const t = typeof l.target === 'string' ? l.target : l.target.id;
        if (s === activeSelectedId) hop1.add(t);
        if (t === activeSelectedId) hop1.add(s);
      });

      const hop2 = new Set<string>();
      if (focusDepth === 2) {
        allLinks.forEach(l => {
          const s = typeof l.source === 'string' ? l.source : l.source.id;
          const t = typeof l.target === 'string' ? l.target : l.target.id;
          if (hop1.has(s)) hop2.add(t);
          if (hop1.has(t)) hop2.add(s);
        });
      }

      // Assign focus levels
      visibleNodes.forEach(n => {
        if (n.id === activeSelectedId) n.focusLevel = 0;
        else if (hop1.has(n.id)) n.focusLevel = 1;
        else if (hop2.has(n.id)) n.focusLevel = 2;
        else n.focusLevel = 3;
      });

      visibleNodes = visibleNodes.filter(n => n.focusLevel !== undefined && n.focusLevel < 3);
      const visibleIds = new Set(visibleNodes.map(n => n.id));

      visibleLinks = allLinks.filter(l => {
        const s = typeof l.source === 'string' ? l.source : l.source.id;
        const t = typeof l.target === 'string' ? l.target : l.target.id;
        return visibleIds.has(s) && visibleIds.has(t);
      });

    } else {
      // INITIAL VIEW FIX: Only top 20 high risk nodes
      const top20 = [...visibleNodes].sort((a, b) => b.risk - a.risk).slice(0, 20);
      const topIds = new Set(top20.map(n => n.id));
      
      visibleNodes = top20;
      visibleNodes.forEach(n => n.focusLevel = 1);

      visibleLinks = allLinks.filter(l => {
        const s = typeof l.source === 'string' ? l.source : l.source.id;
        const t = typeof l.target === 'string' ? l.target : l.target.id;
        return topIds.has(s) && topIds.has(t);
      });
    }

    // Prepare hotspot rows for side panel (use all module nodes before filtering)
    const hotspots = appData.nodes
      .filter((n) => n.type === 'file')
      .map(n => ({...n, kind: 'module', churn: appData.hotspots?.[n.file] || 0} as unknown as AtlasNode))
      .sort((a, b) => (b.risk||0) - (a.risk||0))
      .slice(0, 10);

    return { graphNodes: visibleNodes, graphLinks: visibleLinks, riskRows: hotspots };
  }, [appData, selectedId, searchQuery, focusDepth, showHighRiskOnly, expandedModules, showCalls, showImports]);

  const handleNodeClick = (id: string) => {
    // If it's a file, expand it and set as focus
    const nodeData = appData?.nodes.find(n => n.id === id);
    if (nodeData && nodeData.type === 'file') {
      setExpandedModules(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
    setSelectedId(id);
    setSearchQuery(''); // Clear search to lock focus
  };

  // AI Explainer Hook
  useEffect(() => {
    if (!selectedId || !appData) return;
    const node = appData.nodes.find((n) => n.id === selectedId);
    
    if (!node || node.type !== 'function') {
      setExplanation('Select a function node to view AI explanation.');
      return;
    }

    // Find direct dependencies for context
    const deps = appData.edges.filter(e => e.source === selectedId).map(e => e.target);

    setExplainerLoading(true);
    setExplanation('');

    fetch(`${API_BASE}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoUrl,
        nodeId: selectedId,
        dependencies: deps,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        setExplanation(data.explanation || data.error || 'Failed to explain.');
      })
      .catch(() => {
        setExplanation('Failed to fetch explanation. Check backend connection.');
      })
      .finally(() => {
        setExplainerLoading(false);
      });
  }, [selectedId, repoUrl, appData]);

  // Selected node detailed view using full appData to ensure we don't miss hidden nodes
  const fullSelectedNode = useMemo(() => {
    if (!appData || !selectedId) return null;
    const n = appData.nodes.find(x => x.id === selectedId);
    if (!n) return null;
    
    const churn = appData.hotspots?.[n.file] || 0;
    const calls = appData.edges.filter((e) => e.source === n.id).map((e) => e.target);
    const callers = appData.edges.filter((e) => e.target === n.id).map((e) => e.source);

    return {
      id: n.id,
      label: n.label,
      path: n.file,
      kind: n.type === 'file' ? 'module' : 'function',
      owner: n.owner || 'Unknown',
      risk: n.risk || 0,
      churn,
      loc: 0,
      calls,
      callers
    } as AtlasNode;
  }, [appData, selectedId]);

  const health = appData && appData.nodes.length > 0
    ? Math.round(appData.nodes.reduce((total, node) => total + (100 - (node.risk || 0)), 0) / appData.nodes.length)
    : 100;

  if (!showApp) {
    return <LandingPage onEnter={() => setShowApp(true)} />;
  }

  return (
    <main className="atlas-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="CodeAtlas workspace" onClick={() => setSelectedId(null)}>
          <span className="brand-mark">CA</span>
          <span>
            <strong>CodeAtlas</strong>
            <small>{appData?.repo?.name ? `${appData.repo.name} / main` : 'Workspace'}</small>
          </span>
        </a>

        <div className="topbar-actions">
          <form onSubmit={onSubmit} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #2d3748',
                background: '#1a202c',
                color: 'white',
                width: '280px'
              }}
              disabled={loading}
            />
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? 'Scanning...' : 'Scan repo'}
            </button>
          </form>
        </div>
      </header>

      {/* Intelligent Toolbar */}
      {appData && (
        <div className="intelligent-toolbar">
          <input 
            type="text" 
            placeholder="Search nodes & auto-focus..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="toolbar-search"
          />
          <div className="toolbar-divider"></div>
          
          <label className="toolbar-toggle">
            <input type="checkbox" checked={focusDepth === 2} onChange={(e) => setFocusDepth(e.target.checked ? 2 : 1)} />
            Depth 2
          </label>

          <label className={`toolbar-toggle ${showHighRiskOnly ? 'risk-active' : ''}`}>
            <input type="checkbox" checked={showHighRiskOnly} onChange={(e) => setShowHighRiskOnly(e.target.checked)} />
            Risk &gt; 60 Only
          </label>

          <label className="toolbar-toggle">
            <input type="checkbox" checked={groupByOwner} onChange={(e) => setGroupByOwner(e.target.checked)} />
            Group by Owner
          </label>

          <div className="toolbar-divider"></div>

          <label className="toolbar-toggle">
            <input type="checkbox" checked={showCalls} onChange={(e) => setShowCalls(e.target.checked)} />
            Calls
          </label>

          <label className="toolbar-toggle">
            <input type="checkbox" checked={showImports} onChange={(e) => setShowImports(e.target.checked)} />
            Imports
          </label>

          {selectedId && (
            <button className="ghost-button clear-focus" onClick={() => setSelectedId(null)}>
              Clear Focus
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: '#bc3f3f', color: 'white', padding: '12px', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {loading && !appData && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.1)', borderLeftColor: '#007c70', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          <h2 style={{ marginTop: '20px' }}>Analyzing Repository...</h2>
          <p style={{ color: '#8a96a6' }}>Cloning, parsing AST, and gathering GitHub intelligence.</p>
        </div>
      )}

      {!loading && !appData && !error && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2>No Repository Loaded</h2>
          <p style={{ color: '#8a96a6', maxWidth: '400px', textAlign: 'center', marginTop: '10px' }}>
            Enter a GitHub repository URL in the top right to generate an intelligent focus-based dependency graph.
          </p>
        </div>
      )}

      {appData && (
        <>
          <section className="workspace" id="workspace" aria-label="CodeAtlas workspace">
            <section className="map-stage" aria-label="Dependency graph explorer">
              <div className="stage-toolbar" style={{ borderBottom: 'none' }}>
                <div>
                  <div className="section-kicker">Intelligent Focus Graph</div>
                  <h2>{selectedId ? 'Local neighborhood view' : 'Top 20 high-risk nodes (Click to focus)'}</h2>
                </div>
              </div>

              <div className="graph-wrap">
                <GraphCanvas
                  selectedId={selectedId}
                  onSelect={handleNodeClick}
                  viewMode={viewMode}
                  nodes={graphNodes}
                  links={graphLinks}
                  groupByOwner={groupByOwner}
                />
                <div className="graph-legend" aria-label="Graph legend">
                  <span><i className="legend-module" style={{background: kindColor.module}} />Module/File</span>
                  <span><i className="legend-function" style={{background: kindColor.function}} />Function</span>
                  <span style={{marginLeft: '12px', color: '#8a96a6'}}>Click file to expand/focus</span>
                </div>
              </div>
            </section>

            <aside className="sidebar detail-panel" aria-label="Selected code unit">
              {fullSelectedNode ? (
                <>
                  <div className="section-kicker">Focused Node</div>
                  <h2>{fullSelectedNode.label}</h2>
                  <code>{fullSelectedNode.path}</code>

                  <div className="owner-row" style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 'bold' }}>{fullSelectedNode.owner}</span>
                    <span style={{ color: '#8a96a6', textTransform: 'capitalize' }}>{fullSelectedNode.kind}</span>
                  </div>

                  <div className="risk-card" style={{ marginTop: '16px' }}>
                    <div>
                      <span>Risk score</span>
                      <strong>{fullSelectedNode.risk}</strong>
                    </div>
                    <RiskBar value={fullSelectedNode.risk} />
                    <p style={{ marginTop: '8px' }}>Hotspot Churn Factor: {fullSelectedNode.churn}</p>
                  </div>

                  {fullSelectedNode.kind === 'function' && (
                    <section className="explainer-box" aria-label="AI code explainer" style={{ marginTop: '24px' }}>
                      <div className="section-kicker">AI Explainer</div>
                      {explainerLoading ? (
                        <p style={{ fontStyle: 'italic', color: '#8a96a6' }}>Analyzing function with AI...</p>
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: '1.5' }}>
                          {explanation}
                        </div>
                      )}
                    </section>
                  )}

                  <section className="flow-columns" aria-label="Function flow" style={{ marginTop: '24px' }}>
                    <div>
                      <h3>Incoming ({fullSelectedNode.callers.length})</h3>
                      {fullSelectedNode.callers.length ? (
                        fullSelectedNode.callers.map((id) => {
                          const n = appData.nodes.find(x => x.id === id);
                          if (!n) return null;
                          return (
                            <button key={id} onClick={() => handleNodeClick(id)}>
                              {n.label}
                            </button>
                          );
                        })
                      ) : (
                        <p style={{ color: '#8a96a6' }}>None detected</p>
                      )}
                    </div>
                    <div>
                      <h3>Outgoing ({fullSelectedNode.calls.length})</h3>
                      {fullSelectedNode.calls.length ? (
                        fullSelectedNode.calls.map((id) => {
                          const n = appData.nodes.find(x => x.id === id);
                          if (!n) return null;
                          return (
                            <button key={id} onClick={() => handleNodeClick(id)}>
                              {n.label}
                            </button>
                          );
                        })
                      ) : (
                        <p style={{ color: '#8a96a6' }}>None detected</p>
                      )}
                    </div>
                  </section>
                </>
              ) : (
                <div style={{ height: '100%' }}>
                  <div className="section-kicker">Scan Overview</div>
                  <h1>{appData.repo?.name || 'Repository'}</h1>
                  <p className="lead">
                    {appData.meta?.totalFiles || 0} files mapped. Analyzed in {(appData.meta?.analysisTimeMs / 1000).toFixed(1)}s.
                  </p>

                  <div className="scan-score">
                    <div>
                      <strong>{health}</strong>
                      <span>health</span>
                    </div>
                    <RiskBar value={100 - health} />
                  </div>

                  <div className="quick-stats" aria-label="Repository stats" style={{ marginTop: '24px' }}>
                    <div>
                      <strong>{appData.repo?.stars || 0}</strong>
                      <span>stars</span>
                    </div>
                    <div>
                      <strong>{appData.nodes.length}</strong>
                      <span>nodes</span>
                    </div>
                    <div>
                      <strong>{appData.edges.length}</strong>
                      <span>edges</span>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', marginTop: '40px', alignItems: 'center', justifyContent: 'center', color: '#8a96a6' }}>
                    Select a node to focus graph
                  </div>
                </div>
              )}
            </aside>
          </section>

          <section className="hotspots-band" id="hotspots">
            <div className="band-heading">
              <div>
                <div className="section-kicker">Hotspot Analysis</div>
                <h2>Where change deserves extra attention.</h2>
              </div>
            </div>

            <div className="hotspot-grid">
              {riskRows.map((node, index) => (
                <article className="hotspot-card" key={node.id}>
                  <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 style={{ wordBreak: 'break-all' }}>{node.label}</h3>
                    <p style={{ wordBreak: 'break-all' }}>{node.path}</p>
                    <p style={{ fontSize: '0.8rem', color: '#8a96a6', marginTop: '4px' }}>Owner: {node.owner}</p>
                  </div>
                  <RiskBar value={node.risk} />
                  <button onClick={() => {
                    handleNodeClick(node.id);
                    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });
                  }}>Focus map</button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
