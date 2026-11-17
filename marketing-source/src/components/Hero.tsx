import React, { Suspense } from 'react';
import { ArrowRight, ChevronDown, CheckCircle2 } from 'lucide-react';
import { HERO_CONTENT } from '../constants/content';
import { HeroInfrastructure3D, HeroInfraNode } from './HeroInfrastructure3D';
import { SceneFallback } from './SceneFallback';

interface HeroProps {
  onHealthCheckClick: () => void;
  onExploreServicesClick: () => void;
  onSelectNode: (node: HeroInfraNode) => void;
}

export const Hero: React.FC<HeroProps> = ({
  onHealthCheckClick,
  onExploreServicesClick,
  onSelectNode,
}) => {
  return (
    <section
      id="hero"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        paddingTop: '110px',
        paddingBottom: '80px',
        overflow: 'hidden',
      }}
      aria-label="Hero — AWS Cloud Operations"
    >
      <div className="container" style={{ width: '100%' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
            gap: '40px',
            alignItems: 'center',
            minHeight: 'calc(100vh - 190px)',
          }}
          className="hero-grid"
        >
          {/* ── Left Column: Editorial & Conversion Copy ─────────────────── */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              zIndex: 2,
            }}
          >
            {/* Eyebrow */}
            <div
              className="eyebrow eyebrow-pill"
              style={{ width: 'fit-content', marginBottom: '22px' }}
            >
              <span className="eyebrow-dot" />
              <span>{HERO_CONTENT.eyebrow}</span>
            </div>

            {/* Headline */}
            <h1
              className="headline-display"
              style={{
                marginBottom: '22px',
                textWrap: 'balance',
              }}
            >
              {HERO_CONTENT.headline}
            </h1>

            {/* Subhead */}
            <p
              className="body-lead"
              style={{
                maxWidth: '520px',
                marginBottom: '36px',
              }}
            >
              {HERO_CONTENT.subhead}
            </p>

            {/* CTAs */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '14px',
                marginBottom: '38px',
              }}
            >
              <button
                onClick={onHealthCheckClick}
                className="btn btn-primary"
                style={{
                  boxShadow: '0 4px 20px rgba(56, 217, 255, 0.32)',
                }}
              >
                {HERO_CONTENT.primaryCta}
                <ArrowRight size={17} />
              </button>
              <button
                onClick={onExploreServicesClick}
                className="btn btn-secondary"
              >
                {HERO_CONTENT.secondaryCta}
              </button>
            </div>

            {/* Small trust line */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                fontWeight: 500,
              }}
            >
              <CheckCircle2 size={16} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
              <span>{HERO_CONTENT.trustLine}</span>
            </div>
          </div>

          {/* ── Right Column: 3D Cloud Infrastructure Centerpiece ────────── */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: 'clamp(440px, 58vh, 600px)',
              borderRadius: '20px',
              border: '1px solid var(--border-subtle)',
              background: 'radial-gradient(ellipse at 50% 45%, rgba(17, 28, 48, 0.5) 0%, rgba(6, 10, 18, 0.8) 100%)',
              backdropFilter: 'blur(10px)',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            }}
            className="hero-3d-stage"
          >
            <Suspense
              fallback={
                <SceneFallback
                  onSelectNode={id => {
                    const fallbackNode = {
                      id,
                      name: id.toUpperCase(),
                      detail: 'Infrastructure telemetry subsystem',
                      status: 'Active',
                      color: '#38D9FF',
                      pos: [0, 0, 0] as [number, number, number],
                    };
                    onSelectNode(fallbackNode);
                  }}
                />
              }
            >
              <HeroInfrastructure3D onSelectNode={onSelectNode} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Subtle Scroll Hint */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '22px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--text-muted)',
          fontSize: '0.74rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          pointerEvents: 'none',
        }}
      >
        <ChevronDown size={17} style={{ animation: 'float-subtle 2s ease-in-out infinite' }} />
      </div>

      <style>{`
        @media (max-width: 960px) {
          .hero-grid {
            grid-template-columns: 1fr !important;
            gap: 44px !important;
          }
          .hero-3d-stage {
            height: 420px !important;
          }
        }
      `}</style>
    </section>
  );
};
