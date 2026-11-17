import React, { useState } from 'react';
import { HOW_WE_WORK_CONTENT } from '../constants/content';
import { Search, Stethoscope, SlidersHorizontal, Terminal, Activity, CheckCircle2 } from 'lucide-react';

const STEP_ICONS: Record<string, React.ReactNode> = {
  '01': <Search size={22} color="#38D9FF" />,
  '02': <Stethoscope size={22} color="#7AA8FF" />,
  '03': <SlidersHorizontal size={22} color="#38D9FF" />,
  '04': <Terminal size={22} color="#F59E0B" />,
  '05': <Activity size={22} color="#10B981" />,
};

export const HowWeWorkSection: React.FC = () => {
  const [activeStep, setActiveStep] = useState('01');

  return (
    <section id="how-we-work" className="section" aria-label="How We Work — 5-Phase Process">
      <div className="container">
        {/* Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>OPERATIONAL PROCESS</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            Predictable, disciplined cloud management.
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            We move step-by-step through a clear spatial pipeline, ensuring every infrastructure change
            is audited, tested, documented, and approved.
          </p>
        </div>

        {/* 5-Step Pipeline Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '16px',
          }}
          className="how-we-work-grid"
        >
          {HOW_WE_WORK_CONTENT.map(item => {
            const isSelected = activeStep === item.step;
            return (
              <div
                key={item.step}
                onClick={() => setActiveStep(item.step)}
                style={{
                  background: isSelected ? 'rgba(26, 42, 68, 0.95)' : 'rgba(17, 28, 48, 0.7)',
                  backdropFilter: 'blur(14px)',
                  borderRadius: '16px',
                  border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                  padding: '28px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  transition: 'all var(--transition-norm)',
                  boxShadow: isSelected ? '0 12px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 217, 255, 0.2)' : 'none',
                }}
                className="card-glass"
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.borderColor = 'var(--border-light)';
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.borderColor = 'var(--border-subtle)';
                }}
              >
                {/* Step Number & Icon */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '16px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.25rem',
                      fontWeight: 800,
                      color: isSelected ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    }}
                  >
                    {item.step}
                  </span>

                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '8px',
                      background: 'rgba(56, 217, 255, 0.1)',
                      border: '1px solid rgba(56, 217, 255, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {STEP_ICONS[item.step]}
                  </div>
                </div>

                {/* Title */}
                <h3
                  style={{
                    fontSize: '1.08rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '8px',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {item.title}
                </h3>

                {/* Description */}
                <p
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.55,
                    marginBottom: '20px',
                    flexGrow: 1,
                  }}
                >
                  {item.description}
                </p>

                {/* Outputs List */}
                <div
                  style={{
                    paddingTop: '14px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: 'var(--accent-cyan)',
                      letterSpacing: '0.06em',
                      marginBottom: '4px',
                    }}
                  >
                    {item.systemState.toUpperCase()}
                  </div>
                  {item.outputs.map((out, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '6px',
                        fontSize: '0.74rem',
                        color: 'var(--text-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      <CheckCircle2 size={12} color="var(--accent-cyan)" style={{ marginTop: '2px', flexShrink: 0 }} />
                      <span>{out}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .how-we-work-grid {
            grid-template-columns: repeat(3, 1fr) !important;
          }
        }
        @media (max-width: 768px) {
          .how-we-work-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
