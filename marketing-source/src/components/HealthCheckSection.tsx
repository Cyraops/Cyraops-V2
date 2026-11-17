import React, { useState } from 'react';
import { HEALTH_CHECK_CONTENT } from '../constants/content';
import { CheckCircle2, ArrowRight, AlertTriangle, ShieldCheck, Activity, Search } from 'lucide-react';

interface HealthCheckProps {
  onBookClick: () => void;
}

const SEVERITY_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  high: {
    bg: 'rgba(239, 68, 68, 0.12)',
    color: '#EF4444',
    border: 'rgba(239, 68, 68, 0.3)',
    label: 'High priority risk',
  },
  medium: {
    bg: 'rgba(245, 158, 11, 0.12)',
    color: '#F59E0B',
    border: 'rgba(245, 158, 11, 0.3)',
    label: 'Optimization opportunity',
  },
  low: {
    bg: 'rgba(16, 185, 129, 0.12)',
    color: '#10B981',
    border: 'rgba(16, 185, 129, 0.3)',
    label: 'Low risk cleanup',
  },
};

export const HealthCheckSection: React.FC<HealthCheckProps> = ({ onBookClick }) => {
  const { sampleReport } = HEALTH_CHECK_CONTENT;
  const [isScanning, setIsScanning] = useState(false);

  const runSimulatedScan = () => {
    setIsScanning(true);
    setTimeout(() => setIsScanning(false), 2200);
  };

  return (
    <section
      id="health-check"
      className="section section-alt"
      aria-label="AWS Cloud Health Check Feature"
    >
      <div className="container">
        {/* Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>INITIAL ENGAGEMENT &middot; FIXED SCOPE</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            {HEALTH_CHECK_CONTENT.headline}
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            {HEALTH_CHECK_CONTENT.body}
          </p>
        </div>

        {/* Two-Column Feature Layout */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
            gap: '40px',
            alignItems: 'start',
          }}
          className="health-check-grid"
        >
          {/* Left Column: What's Included & Pricing Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Scope inclusions */}
            <div
              style={{
                background: 'rgba(17, 28, 48, 0.8)',
                backdropFilter: 'blur(14px)',
                borderRadius: '16px',
                border: '1px solid var(--border-subtle)',
                padding: '32px',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <h3
                style={{
                  fontSize: '1.18rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <ShieldCheck size={20} color="var(--accent-cyan)" />
                What&apos;s Included in the Health Check
              </h3>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {HEALTH_CHECK_CONTENT.includes.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '0.92rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <CheckCircle2 size={16} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Pricing Box */}
            <div
              style={{
                background: 'rgba(17, 28, 48, 0.9)',
                backdropFilter: 'blur(14px)',
                borderRadius: '16px',
                border: '1px solid var(--border-cyan)',
                padding: '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                boxShadow: 'var(--shadow-cyan)',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '1.75rem',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {HEALTH_CHECK_CONTENT.priceNote}
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {HEALTH_CHECK_CONTENT.priceSub}
                </div>
              </div>

              <button
                onClick={onBookClick}
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start', padding: '13px 26px' }}
              >
                {HEALTH_CHECK_CONTENT.primaryCta}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>

          {/* Right Column: Visual Health Scan & Diagnostic Findings Report Card */}
          <div
            style={{
              background: 'rgba(17, 28, 48, 0.85)',
              backdropFilter: 'blur(16px)',
              borderRadius: '18px',
              border: '1px solid var(--border-subtle)',
              padding: '32px',
              boxShadow: 'var(--shadow-lg)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Scan animation pulse bar */}
            {isScanning && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '3px',
                  background: 'linear-gradient(90deg, transparent, #38D9FF, transparent)',
                  animation: 'scan-line 1.2s ease-in-out infinite',
                }}
              />
            )}

            {/* Diagnostic Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px',
                paddingBottom: '14px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'var(--accent-cyan)',
                    letterSpacing: '0.08em',
                  }}
                >
                  {sampleReport.badge}
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {sampleReport.title}
                </div>
              </div>

              <button
                onClick={runSimulatedScan}
                disabled={isScanning}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'rgba(56, 217, 255, 0.1)',
                  border: '1px solid rgba(56, 217, 255, 0.3)',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  color: 'var(--accent-cyan)',
                  cursor: isScanning ? 'wait' : 'pointer',
                }}
              >
                <Activity size={13} />
                <span>{isScanning ? 'Scanning...' : 'Trigger Scan'}</span>
              </button>
            </div>

            {/* Diagnostic Findings Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {sampleReport.findings.map(finding => {
                const style = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.medium;
                return (
                  <div
                    key={finding.id}
                    style={{
                      padding: '16px',
                      borderRadius: '10px',
                      background: 'rgba(11, 18, 32, 0.7)',
                      border: `1px solid ${style.border}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: style.bg,
                            color: style.color,
                            border: `1px solid ${style.border}`,
                          }}
                        >
                          {finding.node}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: style.color, fontWeight: 600 }}>
                          {style.label}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '0.92rem',
                        fontWeight: 650,
                        color: 'var(--text-primary)',
                        marginBottom: '6px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                      }}
                    >
                      <AlertTriangle size={15} color={style.color} style={{ marginTop: '3px', flexShrink: 0 }} />
                      <span>{finding.title}</span>
                    </div>

                    <p
                      style={{
                        fontSize: '0.82rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                        paddingLeft: '23px',
                        marginBottom: '8px',
                      }}
                    >
                      {finding.detail}
                    </p>

                    <div
                      style={{
                        paddingLeft: '23px',
                        fontSize: '0.76rem',
                        color: 'var(--accent-cyan)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      &rarr; Assessment: {finding.impact}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Report Card Bottom Status */}
            <div
              style={{
                marginTop: '20px',
                paddingTop: '16px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.76rem',
                color: 'var(--text-muted)',
              }}
            >
              <span>{sampleReport.status}</span>
              <span>Prioritized Written Deliverable Included</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .health-check-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
