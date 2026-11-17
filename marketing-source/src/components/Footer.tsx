import React from 'react';

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
        padding: '64px 0 36px 0',
        position: 'relative',
        zIndex: 1,
      }}
      role="contentinfo"
      aria-label="Site Footer"
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) repeat(2, minmax(0, 1fr))',
            gap: '48px',
            marginBottom: '48px',
          }}
          className="footer-grid"
        >
          {/* Brand & Purpose (Exact copy from Spec Section 19) */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '14px',
              }}
            >
              <span className="brand-mark" aria-hidden="true"><img src="/cyraops-mark.png" alt="" /></span>
              <span
                style={{
                  fontSize: '1.02rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  color: '#F8FAFC',
                }}
              >
                CYRA<span style={{ color: '#38D9FF', fontWeight: 600 }}>OPS</span>
              </span>
            </div>

            <p
              style={{
                fontSize: '0.92rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                maxWidth: '340px',
                fontWeight: 500,
              }}
            >
              Managed AWS Cloud Operations for startups and small businesses.
            </p>
          </div>

          {/* Solutions & Core Links (Exact from Spec Section 19) */}
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.74rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '18px',
              }}
            >
              Solutions
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <li>
                <button
                  onClick={() => scrollTo('services')}
                  style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#38D9FF')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                >
                  Services
                </button>
              </li>
              <li>
                <button
                  onClick={() => scrollTo('health-check')}
                  style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#38D9FF')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                >
                  Cloud Health Check
                </button>
              </li>
              <li>
                <button
                  onClick={() => scrollTo('managed-care')}
                  style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#38D9FF')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                >
                  Managed Cloud
                </button>
              </li>
            </ul>
          </div>

          {/* Navigation & Legal Links */}
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.74rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '18px',
              }}
            >
              Navigation
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <li>
                <button
                  onClick={() => scrollTo('contact')}
                  style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#38D9FF')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                >
                  Contact
                </button>
              </li>
              <li>
                <span
                  style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}
                  title="Placeholder terms upon client agreement confirmation"
                >
                  Privacy (Standard policy upon engagement)
                </span>
              </li>
              <li>
                <span
                  style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}
                  title="Placeholder terms upon client agreement confirmation"
                >
                  Terms (Governed by signed statement of work)
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar with Dynamic Year */}
        <div
          style={{
            paddingTop: '24px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            fontSize: '0.80rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>&copy; {currentYear} CyraOps. All rights reserved.</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <span>AWS Cloud Operations &middot; Reliability &middot; Monitoring &middot; Cost Optimization</span>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 800px) {
          .footer-grid {
            grid-template-columns: 1fr !important;
            gap: 32px !important;
          }
        }
      `}</style>
    </footer>
  );
};
