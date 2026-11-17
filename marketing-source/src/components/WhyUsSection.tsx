import React from 'react';
import { WHY_US_CONTENT } from '../constants/content';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

export const WhyUsSection: React.FC = () => {
  return (
    <section
      id="why-us"
      className="section section-alt"
      aria-label="Why Choose CyraOps"
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
            gap: '64px',
            alignItems: 'start',
          }}
          className="why-us-grid"
        >
          {/* Left Column: Headline & Purpose */}
          <div>
            <div className="eyebrow eyebrow-pill" style={{ marginBottom: '20px' }}>
              <span className="eyebrow-dot" />
              <span>PRACTICAL DIFFERENTIATION</span>
            </div>

            <h2 className="headline-lg" style={{ marginBottom: '20px' }}>
              {WHY_US_CONTENT.headline}
            </h2>

            <p className="body-lead" style={{ marginBottom: '28px' }}>
              We are not an enterprise consulting firm trying to bill endless hours. We are a dedicated
              cloud operations practice built specifically for startups and small engineering teams who need
              their AWS environments quiet, monitored, and dependable.
            </p>

            <div
              style={{
                padding: '20px 24px',
                borderRadius: '12px',
                background: 'rgba(17, 28, 48, 0.7)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <ShieldCheck size={22} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                Zero lock-in &middot; Clear change logs &middot; Direct communication with experienced cloud operators
              </span>
            </div>
          </div>

          {/* Right Column: 5 Exact Bullets from Spec */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {WHY_US_CONTENT.points.map((point, i) => (
              <div
                key={i}
                style={{
                  padding: '22px 24px',
                  borderRadius: '12px',
                  background: 'rgba(17, 28, 48, 0.7)',
                  border: '1px solid var(--border-subtle)',
                  transition: 'all var(--transition-norm)',
                }}
                className="card-glass"
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--border-light)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '6px',
                      background: 'rgba(56, 217, 255, 0.12)',
                      border: '1px solid rgba(56, 217, 255, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>

                  <div>
                    <h3
                      style={{
                        fontSize: '1.02rem',
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        marginBottom: '6px',
                        lineHeight: 1.4,
                      }}
                    >
                      {point.title}
                    </h3>
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                      {point.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .why-us-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
