import React, { useState } from 'react';
import { FAQ_CONTENT } from '../constants/content';
import { ChevronDown, HelpCircle } from 'lucide-react';

export const FAQSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (i: number) => setOpenIndex(prev => (prev === i ? null : i));

  return (
    <section id="faq" className="section" aria-label="Frequently asked questions">
      <div className="container">
        {/* Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>CLARITY &amp; SCOPE</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            Frequently asked questions.
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            Direct answers regarding access, security boundaries, support scope, and engagement models.
          </p>
        </div>

        {/* Accordion List */}
        <div
          style={{
            maxWidth: '760px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {FAQ_CONTENT.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={i}
                style={{
                  borderRadius: '12px',
                  background: isOpen ? 'rgba(26, 42, 68, 0.95)' : 'rgba(17, 28, 48, 0.7)',
                  border: `1px solid ${isOpen ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                  overflow: 'hidden',
                  transition: 'all 0.22s ease',
                  boxShadow: isOpen ? '0 8px 24px rgba(0, 0, 0, 0.35)' : 'none',
                }}
              >
                <button
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '20px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: isOpen ? '#F8FAFC' : 'var(--text-primary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {item.question}
                  </span>
                  <ChevronDown
                    size={18}
                    color={isOpen ? 'var(--accent-cyan)' : 'var(--text-muted)'}
                    style={{
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform 0.22s ease',
                      flexShrink: 0,
                    }}
                  />
                </button>

                {isOpen && (
                  <div
                    style={{
                      padding: '0 24px 20px 24px',
                      fontSize: '0.90rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.65,
                      borderTop: '1px solid rgba(148, 163, 184, 0.1)',
                      paddingTop: '14px',
                      animation: 'float-subtle 0.2s ease',
                    }}
                  >
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
