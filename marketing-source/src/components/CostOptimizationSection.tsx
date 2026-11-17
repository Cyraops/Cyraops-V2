import React, { useState } from 'react';
import { COST_DASHBOARD_CONTENT } from '../constants/content';
import { TrendingDown, ArrowRight, DollarSign, Layers, CheckCircle2, AlertCircle } from 'lucide-react';

interface CostProps {
  onFindOpportunitiesClick: () => void;
}

export const CostOptimizationSection: React.FC<CostProps> = ({ onFindOpportunitiesClick }) => {
  const [activeCategoryId, setActiveCategoryId] = useState(COST_DASHBOARD_CONTENT.categories[0].id);
  const [journeyStage, setJourneyStage] = useState<'before' | 'opportunities' | 'optimized'>('opportunities');

  const active = COST_DASHBOARD_CONTENT.categories.find(c => c.id === activeCategoryId) || COST_DASHBOARD_CONTENT.categories[0];

  const totalCurrent = COST_DASHBOARD_CONTENT.categories.reduce((s, c) => s + c.currentSpend, 0);
  const totalOptimized = COST_DASHBOARD_CONTENT.categories.reduce((s, c) => s + c.optimizedSpend, 0);
  const totalSaving = totalCurrent - totalOptimized;

  const displaySpend = journeyStage === 'before' ? totalCurrent : totalOptimized;

  return (
    <section id="optimize" className="section" aria-label="Cost Optimization Experience">
      <div className="container">
        {/* Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>FINOPS &amp; EFFICIENCY</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            {COST_DASHBOARD_CONTENT.headline}
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            {COST_DASHBOARD_CONTENT.subhead}
          </p>
        </div>

        {/* Conceptual Cost Dashboard */}
        <div
          style={{
            background: 'rgba(17, 28, 48, 0.85)',
            backdropFilter: 'blur(16px)',
            borderRadius: '20px',
            border: '1px solid var(--border-subtle)',
            padding: '36px 32px',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* Top Bar: Journey Stage Tabs & Demo Label */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              paddingBottom: '20px',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: '28px',
            }}
          >
            {/* Conceptual Journey Segmented Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {[
                { id: 'before', label: '1. Baseline Spend' },
                { id: 'opportunities', label: '2. Waste Drivers Identified' },
                { id: 'optimized', label: '3. Calibrated Architecture' },
              ].map(stage => {
                const isSelected = journeyStage === stage.id;
                return (
                  <button
                    key={stage.id}
                    onClick={() => setJourneyStage(stage.id as any)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.76rem',
                      fontWeight: 650,
                      padding: '8px 14px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(56, 217, 255, 0.16)' : 'rgba(11, 18, 32, 0.6)',
                      border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                      color: isSelected ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {stage.label}
                  </button>
                );
              })}
            </div>

            {/* Disclaimer Label: Explicit illustrative/demo data */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                color: '#F59E0B',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                padding: '4px 12px',
                borderRadius: '100px',
              }}
            >
              ⚠ {COST_DASHBOARD_CONTENT.disclaimer}
            </div>
          </div>

          {/* Dashboard Main Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
              gap: '36px',
              alignItems: 'start',
            }}
            className="cost-dash-grid"
          >
            {/* Left: Category Selectors & Totals */}
            <div>
              {/* Category Buttons: Compute, Storage, Database, Network, Monitoring */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                {COST_DASHBOARD_CONTENT.categories.map(cat => {
                  const isSelected = activeCategoryId === cat.id;
                  const catSaving = cat.currentSpend - cat.optimizedSpend;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategoryId(cat.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 18px',
                        borderRadius: '10px',
                        textAlign: 'left',
                        background: isSelected ? 'rgba(26, 42, 68, 0.95)' : 'rgba(11, 18, 32, 0.6)',
                        border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                        boxShadow: isSelected ? '0 4px 16px rgba(0, 0, 0, 0.35)' : 'none',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.94rem', fontWeight: 650, color: isSelected ? '#F8FAFC' : 'var(--text-secondary)' }}>
                          {cat.name}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          Hover / Click to inspect cost drivers
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          ${cat.currentSpend}/mo
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                          -${catSaving}/mo potential
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Summary Metrics */}
              <div
                style={{
                  padding: '20px',
                  borderRadius: '12px',
                  background: 'rgba(11, 18, 32, 0.75)',
                  border: '1px solid var(--border-subtle)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '16px',
                  textAlign: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Current Baseline</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    ${totalCurrent}/mo
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '4px' }}>After Optimization</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                    ${totalOptimized}/mo
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Potential Elimination</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>
                    -${totalSaving}/mo
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Detailed Category Cost Drivers & Action Plan */}
            <div
              style={{
                background: 'rgba(11, 18, 32, 0.8)',
                borderRadius: '14px',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                padding: '28px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    color: 'var(--accent-cyan)',
                    letterSpacing: '0.08em',
                  }}
                >
                  CATEGORY AUDIT &middot; {active.name.toUpperCase()}
                </span>
                <span style={{ fontSize: '0.74rem', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  Potential: -${active.currentSpend - active.optimizedSpend}/mo
                </span>
              </div>

              <h3 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>
                Identified Cost Drivers
              </h3>

              {/* Waste Drivers List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                {active.wasteDrivers.map((driver, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: 'rgba(17, 28, 48, 0.6)',
                      border: '1px solid rgba(148, 163, 184, 0.1)',
                      fontSize: '0.86rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <AlertCircle size={15} color="#F59E0B" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span>{driver}</span>
                  </div>
                ))}
              </div>

              {/* Recommended Operational Action */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'rgba(56, 217, 255, 0.08)',
                  border: '1px solid rgba(56, 217, 255, 0.25)',
                  marginBottom: '28px',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '6px' }}>
                  OPERATIONAL REMEDIATION ACTION
                </div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>
                  {active.action}
                </div>
              </div>

              {/* Exact CTA */}
              <button
                onClick={onFindOpportunitiesClick}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '14px' }}
              >
                {COST_DASHBOARD_CONTENT.ctaText}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .cost-dash-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
