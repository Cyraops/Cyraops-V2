import React from 'react';
import { FINAL_CTA_CONTENT } from '../constants/content';
import { ArrowRight, MessageSquare } from 'lucide-react';

interface FinalCTAProps {
  onHealthCheckClick: () => void;
  onOngoingCareClick: () => void;
}

export const FinalCTASection: React.FC<FinalCTAProps> = ({
  onHealthCheckClick,
  onOngoingCareClick,
}) => {
  return (
    <section
      id="cta"
      className="section section-alt"
      aria-label="Final Call to Action"
    >
      <div className="container">
        <div
          style={{
            maxWidth: '720px',
            margin: '0 auto',
            textAlign: 'center',
            background: 'rgba(17, 28, 48, 0.85)',
            backdropFilter: 'blur(16px)',
            borderRadius: '24px',
            border: '1px solid var(--border-cyan)',
            padding: '56px 40px',
            boxShadow: 'var(--shadow-cyan)',
          }}
        >
          <div className="eyebrow eyebrow-pill" style={{ justifyContent: 'center', marginBottom: '22px' }}>
            <span className="eyebrow-dot" />
            <span>READY TO SIMPLIFY</span>
          </div>

          <h2
            className="headline-lg"
            style={{
              marginBottom: '18px',
              textWrap: 'balance',
            }}
          >
            {FINAL_CTA_CONTENT.headline}
          </h2>

          <p
            className="body-lead"
            style={{
              marginBottom: '36px',
              maxWidth: '560px',
              margin: '0 auto 36px auto',
            }}
          >
            {FINAL_CTA_CONTENT.subhead}
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '14px',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={onHealthCheckClick}
              className="btn btn-primary"
              style={{ padding: '14px 26px', fontSize: '0.92rem' }}
            >
              {FINAL_CTA_CONTENT.primaryCta}
              <ArrowRight size={17} />
            </button>
            <button
              onClick={onOngoingCareClick}
              className="btn btn-secondary"
              style={{ padding: '14px 26px', fontSize: '0.92rem' }}
            >
              {FINAL_CTA_CONTENT.secondaryCta}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
