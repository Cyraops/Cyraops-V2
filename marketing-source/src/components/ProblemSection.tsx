import React, { useState } from 'react';
import { PROBLEM_CONTENT } from '../constants/content';
import { AlertTriangle, CheckCircle2, ShieldAlert, Cpu, ArrowRight } from 'lucide-react';

export const ProblemSection: React.FC = () => {
  const [activeRiskId, setActiveRiskId] = useState(PROBLEM_CONTENT.risks[0].id);
  const [isOrganized, setIsOrganized] = useState(false);

  const activeRisk = PROBLEM_CONTENT.risks.find(r => r.id === activeRiskId) || PROBLEM_CONTENT.risks[0];

  return (
    <section
      id="problem"
      className="section section-alt"
      aria-label="Cloud infrastructure problem"
    >
      <div className="container">
        {/* Section Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>OPERATIONAL REALITY</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            {PROBLEM_CONTENT.headline}
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            {PROBLEM_CONTENT.supportingCopy}
          </p>
        </div>

        {/* Interactive Treatment: Floating / Misaligned Objects that organize into a clean system */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '36px',
            alignItems: 'center',
          }}
          className="problem-grid"
        >
          {/* Left Column: Interactive Problem Labels */}
          <div
            style={{
              background: 'rgba(17, 28, 48, 0.75)',
              backdropFilter: 'blur(14px)',
              borderRadius: '16px',
              border: '1px solid var(--border-subtle)',
              padding: '32px 28px',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: isOrganized ? 'var(--accent-emerald)' : '#F59E0B',
                  letterSpacing: '0.08em',
                }}
              >
                {isOrganized ? 'SYSTEM: CONTROLLED & AUDITED' : 'SYSTEM: UNMANAGED DRIFT'}
              </span>

              <button
                onClick={() => setIsOrganized(!isOrganized)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.74rem',
                  padding: '4px 12px',
                  borderRadius: '100px',
                  background: isOrganized ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 217, 255, 0.12)',
                  border: `1px solid ${isOrganized ? '#10B981' : 'var(--accent-cyan)'}`,
                  color: isOrganized ? '#10B981' : 'var(--accent-cyan)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {isOrganized ? 'Show Drift' : 'Organize System'}
              </button>
            </div>

            {/* List of 5 Interactive Problem Labels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {PROBLEM_CONTENT.risks.map((risk, index) => {
                const isSelected = activeRiskId === risk.id;
                // When unorganized, create intentional slight misalignment/drift rotation
                const driftTransform = !isOrganized
                  ? `translate(${Math.sin(index * 2) * 6}px, ${Math.cos(index * 2) * 3}px)`
                  : 'translate(0, 0)';

                return (
                  <button
                    key={risk.id}
                    onClick={() => setActiveRiskId(risk.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      textAlign: 'left',
                      background: isSelected
                        ? 'rgba(26, 42, 68, 0.95)'
                        : isOrganized
                        ? 'rgba(11, 18, 32, 0.6)'
                        : 'rgba(20, 28, 44, 0.45)',
                      border: `1px solid ${
                        isSelected
                          ? isOrganized
                            ? 'var(--accent-emerald)'
                            : 'var(--accent-cyan)'
                          : 'var(--border-subtle)'
                      }`,
                      boxShadow: isSelected ? '0 4px 16px rgba(0, 0, 0, 0.35)' : 'none',
                      transform: driftTransform,
                      transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isOrganized ? 'var(--accent-emerald)' : '#F59E0B',
                          boxShadow: `0 0 6px ${isOrganized ? '#10B981' : '#F59E0B'}`,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          color: isSelected ? '#F8FAFC' : 'var(--text-secondary)',
                        }}
                      >
                        {risk.tag}
                      </span>
                    </div>

                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {isSelected ? 'Inspecting' : 'Click to inspect'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Problem Resolution & Stewardship Card */}
          <div
            style={{
              background: 'rgba(17, 28, 48, 0.85)',
              backdropFilter: 'blur(16px)',
              borderRadius: '16px',
              border: `1px solid ${isOrganized ? 'rgba(16, 185, 129, 0.35)' : 'rgba(56, 217, 255, 0.25)'}`,
              padding: '36px 32px',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: isOrganized ? 'var(--accent-emerald)' : 'var(--accent-cyan)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                INFRASTRUCTURE DIAGNOSTIC &middot; {activeRisk.tag}
              </span>
            </div>

            {/* The Specific Symptom */}
            <div style={{ marginBottom: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  marginBottom: '10px',
                }}
              >
                <AlertTriangle size={18} color="#F59E0B" style={{ marginTop: '2px', flexShrink: 0 }} />
                <h3
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    lineHeight: 1.35,
                  }}
                >
                  {activeRisk.problem}
                </h3>
              </div>
            </div>

            {/* Operational System Resolution */}
            <div
              style={{
                background: 'rgba(11, 18, 32, 0.75)',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid rgba(148, 163, 184, 0.12)',
                marginBottom: '28px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: isOrganized ? 'var(--accent-emerald)' : 'var(--accent-cyan)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckCircle2 size={15} />
                <span>Operational Resolution</span>
              </div>
              <p
                style={{
                  fontSize: '0.90rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {activeRisk.resolution}
              </p>
            </div>

            <p
              style={{
                fontSize: '0.84rem',
                color: 'var(--text-muted)',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              We help you regain complete visibility and control — before small, silent issues accumulate into costly downtime.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .problem-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
