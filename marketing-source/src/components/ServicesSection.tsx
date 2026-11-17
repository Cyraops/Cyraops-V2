import React, { useState } from 'react';
import { SERVICES_CONTENT } from '../constants/content';
import { Monitor, TrendingDown, Shield, ArrowUpRight, ChevronDown, Check, ArrowRight } from 'lucide-react';

interface ServicesProps {
  onSelectService: (serviceTitle: string) => void;
}

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  monitor:  <Monitor size={22} color="#38D9FF" />,
  optimize: <TrendingDown size={22} color="#7AA8FF" />,
  maintain: <Shield size={22} color="#10B981" />,
  migrate:  <ArrowUpRight size={22} color="#38D9FF" />,
};

export const ServicesSection: React.FC<ServicesProps> = ({ onSelectService }) => {
  const [expandedId, setExpandedId] = useState<string | null>('monitor');

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <section id="services" className="section" aria-label="Services — Managed AWS Cloud Operations">
      <div className="container">
        {/* Section Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>PRIMARY SERVICES</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            Managed AWS operations designed for focus.
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            We handle the operational baseline—monitoring, spend, maintenance, and migrations—so your
            engineering team can stay focused on building the core product.
          </p>
        </div>

        {/* 4 Interactive Service Cards with Tilt & Expand */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '24px',
          }}
          className="services-grid"
        >
          {SERVICES_CONTENT.map(service => {
            const isExpanded = expandedId === service.id;
            return (
              <div
                key={service.id}
                style={{
                  background: 'rgba(17, 28, 48, 0.75)',
                  backdropFilter: 'blur(14px)',
                  borderRadius: '16px',
                  border: `1px solid ${isExpanded ? 'rgba(56, 217, 255, 0.35)' : 'var(--border-subtle)'}`,
                  padding: '30px',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all var(--transition-norm)',
                  boxShadow: isExpanded ? '0 12px 40px rgba(0, 0, 0, 0.45)' : 'var(--shadow-sm)',
                }}
                className="card-glass"
              >
                {/* Card Top: Number & Icon */}
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
                      color: 'var(--accent-cyan)',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {service.number} &mdash; {service.title}
                  </span>

                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '10px',
                      background: 'rgba(56, 217, 255, 0.1)',
                      border: '1px solid rgba(56, 217, 255, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {SERVICE_ICONS[service.id]}
                  </div>
                </div>

                {/* Tagline */}
                <h3
                  style={{
                    fontSize: '1.18rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '10px',
                    lineHeight: 1.35,
                  }}
                >
                  {service.tagline}
                </h3>

                {/* Description */}
                <p
                  style={{
                    fontSize: '0.90rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    marginBottom: '20px',
                    flexGrow: 1,
                  }}
                >
                  {service.description}
                </p>

                {/* Click / Tap to Expand Deliverables Button */}
                <button
                  onClick={() => toggleExpand(service.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: 'rgba(11, 18, 32, 0.7)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    marginBottom: isExpanded ? '18px' : '0',
                  }}
                  aria-expanded={isExpanded}
                >
                  <span>{isExpanded ? 'Hide Deliverables' : 'Inspect Deliverables'}</span>
                  <ChevronDown
                    size={16}
                    color="var(--accent-cyan)"
                    style={{
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform 0.25s ease',
                    }}
                  />
                </button>

                {/* Expandable Deliverables Drawer */}
                {isExpanded && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      paddingTop: '6px',
                      animation: 'float-subtle 0.2s ease',
                    }}
                  >
                    {service.deliverables.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          fontSize: '0.84rem',
                          color: 'var(--text-secondary)',
                          lineHeight: 1.5,
                        }}
                      >
                        <Check size={15} color="var(--accent-cyan)" style={{ marginTop: '2px', flexShrink: 0 }} />
                        <span>{item}</span>
                      </div>
                    ))}

                    <div
                      style={{
                        marginTop: '14px',
                        paddingTop: '14px',
                        borderTop: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.74rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {service.metrics}
                      </span>

                      <button
                        onClick={() => onSelectService(service.title)}
                        className="btn btn-outline-cyan"
                        style={{
                          padding: '6px 14px',
                          fontSize: '0.78rem',
                        }}
                      >
                        Inquire
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .services-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
