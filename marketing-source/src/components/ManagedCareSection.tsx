import React from 'react';
import { MANAGED_CARE_CONTENT } from '../constants/content';
import { CheckCircle2, ArrowRight, ShieldCheck, Info } from 'lucide-react';

interface ManagedCareProps {
  onContactClick: () => void;
}

export const ManagedCareSection: React.FC<ManagedCareProps> = ({ onContactClick }) => {
  return (
    <section
      id="managed-care"
      className="section section-alt"
      aria-label="Managed Cloud Care Service"
    >
      <div className="container">
        {/* Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>RECURRING OPERATIONAL STEWARDSHIP</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            {MANAGED_CARE_CONTENT.headline}
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            Experienced AWS operational management and continuous oversight without the overhead of
            hiring an in-house cloud engineer.
          </p>
        </div>

        {/* Feature Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '40px',
            alignItems: 'center',
          }}
          className="managed-care-grid"
        >
          {/* Left Column: Scope Inclusions Card */}
          <div
            style={{
              background: 'rgba(17, 28, 48, 0.8)',
              backdropFilter: 'blur(14px)',
              borderRadius: '18px',
              border: '1px solid var(--border-subtle)',
              padding: '36px 32px',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <h3
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: '22px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <ShieldCheck size={22} color="var(--accent-cyan)" />
              Included in Cloud Care
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {MANAGED_CARE_CONTENT.includedItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '0.94rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <CheckCircle2 size={18} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Pricing & Scope Commitment Card */}
          <div
            style={{
              background: 'rgba(17, 28, 48, 0.9)',
              backdropFilter: 'blur(16px)',
              borderRadius: '18px',
              border: '1px solid var(--border-cyan)',
              padding: '36px 32px',
              boxShadow: 'var(--shadow-cyan)',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '2rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.02em',
                  marginBottom: '4px',
                }}
              >
                {MANAGED_CARE_CONTENT.startingPrice}
              </div>
              <div
                style={{
                  fontSize: '0.88rem',
                  color: 'var(--accent-cyan)',
                  fontWeight: 600,
                }}
              >
                {MANAGED_CARE_CONTENT.subText}
              </div>
            </div>

            {/* Scope Note (Mandatory from Spec) */}
            <div
              style={{
                padding: '16px 18px',
                borderRadius: '10px',
                background: 'rgba(11, 18, 32, 0.8)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
              }}
            >
              <Info size={16} color="var(--text-muted)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                {MANAGED_CARE_CONTENT.scopeNote}
              </p>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              {MANAGED_CARE_CONTENT.scaleNote}
            </p>

            <button
              onClick={onContactClick}
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start', padding: '14px 26px' }}
            >
              Talk about ongoing cloud operations
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .managed-care-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
