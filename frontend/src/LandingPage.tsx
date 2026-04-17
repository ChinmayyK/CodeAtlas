import { useEffect, useRef } from 'react';
import './landing.css';

interface LandingPageProps {
  onEnter: () => void;
}

export function LandingPage({ onEnter }: LandingPageProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });

    const elements = document.querySelectorAll('.fade-up');
    elements.forEach((el) => observerRef.current?.observe(el));

    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="landing-layout">
      <nav className="landing-nav fade-up">
        <div className="landing-brand">
          <div className="landing-logo">CA</div>
          <span>CodeAtlas</span>
        </div>
        <div className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#intelligence">Intelligence</a>
          <a href="#security">Security</a>
        </div>
        <button className="landing-btn-secondary" onClick={onEnter}>
          Sign In
        </button>
      </nav>

      <header className="landing-hero fade-up">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className="badge">CodeAtlas v4.0 Intelligence Engine</div>
          <h1 className="hero-title">
            Understand Code at the <br />
            <span className="text-gradient">Speed of Thought.</span>
          </h1>
          <p className="hero-subtitle">
            The first autonomous intelligence engine that maps your entire repository, detects architectural hotspots, and explains complex dependencies in seconds.
          </p>
          <div className="hero-actions">
            <button className="landing-btn-primary" onClick={onEnter}>
              Launch Workspace
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
            <button className="landing-btn-secondary outline" onClick={onEnter}>
              View Demo
            </button>
          </div>
        </div>
        
        <div className="hero-visual fade-up" style={{ animationDelay: '0.2s' }}>
          <div className="glass-panel main-dashboard">
            <div className="panel-header">
              <div className="mac-dots">
                <span className="dot red"></span>
                <span className="dot yellow"></span>
                <span className="dot green"></span>
              </div>
              <div className="panel-title">northstar-api / scan-results</div>
            </div>
            <div className="panel-body">
              <div className="abstract-graph">
                <div className="node n1"></div>
                <div className="node n2"></div>
                <div className="node n3"></div>
                <div className="node n4"></div>
                <div className="edge e1"></div>
                <div className="edge e2"></div>
                <div className="edge e3"></div>
              </div>
              <div className="glass-card risk-card-preview">
                <div className="risk-header">
                  <span>scoreHotspots.ts</span>
                  <span className="risk-badge">88 Risk</span>
                </div>
                <div className="risk-bar-mini">
                  <div className="risk-fill" style={{ width: '88%' }}></div>
                </div>
                <div className="risk-details">
                  Combines churn, centrality, and ownership signals to rank files.
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="landing-section" id="features">
        <div className="section-header fade-up">
          <h2>Not just search. <span className="text-gradient">True intelligence.</span></h2>
          <p>Traditional search tools find text. CodeAtlas understands relationships, risk, and architecture.</p>
        </div>
        
        <div className="bento-grid fade-up">
          <div className="bento-card span-2 glass-panel">
            <div className="bento-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            </div>
            <h3>Architectural Hotspots</h3>
            <p>Automatically identify files that are changed frequently, highly central to your graph, and scattered across multiple owners.</p>
            <div className="bento-visual risk-visual">
              <div className="bar-chart">
                <div className="bar" style={{height: '40%'}}></div>
                <div className="bar" style={{height: '70%'}}></div>
                <div className="bar active" style={{height: '95%'}}></div>
                <div className="bar" style={{height: '50%'}}></div>
                <div className="bar" style={{height: '30%'}}></div>
              </div>
            </div>
          </div>
          
          <div className="bento-card glass-panel">
            <div className="bento-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
            <h3>Dependency Mapping</h3>
            <p>Visual, interactive graphs of your entire codebase's dependency tree.</p>
          </div>
          
          <div className="bento-card glass-panel">
            <div className="bento-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <h3>AI Explainability</h3>
            <p>Plain-language module notes grounded in parsed symbols and paths.</p>
          </div>
        </div>
      </section>

      <section className="landing-cta fade-up">
        <div className="cta-content glass-panel">
          <h2>Ready to map your codebase?</h2>
          <p>Join thousands of elite engineering teams using CodeAtlas.</p>
          <button className="landing-btn-primary" onClick={onEnter}>
            Enter CodeAtlas
          </button>
        </div>
      </section>
      
      <footer className="landing-footer">
        <div className="footer-brand">
          <div className="landing-logo small">CA</div>
          <span>CodeAtlas © 2026</span>
        </div>
        <div className="footer-links">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Documentation</a>
        </div>
      </footer>
    </div>
  );
}
