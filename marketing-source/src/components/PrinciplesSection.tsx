import React from 'react';
import { ShieldCheck, FileCode, MessageSquare, Terminal, Gauge, Target } from 'lucide-react';

export const PrinciplesSection: React.FC = () => {
  const principles = [
    {
      title: 'Security considered from the start',
      desc: 'Least privilege, cryptographic isolation, and zero-trust policies are engineered into the base architecture, never retrofitted as an afterthought.',
      icon: <ShieldCheck size={22} color="#10B981" />,
      accent: '#10B981',
    },
    {
      title: 'Documented, repeatable operations',
      desc: 'Every system is codified in Infrastructure as Code with living operational runbooks, ensuring any deployment or recovery drill is deterministic and repeatable.',
      icon: <FileCode size={22} color="#38D9FF" />,
      accent: '#38D9FF',
    },
    {
      title: 'Clear, transparent communication',
      desc: 'We speak directly in engineering realities without jargon or obfuscation. Architecture trade-offs, constraints, and operational risks are shared openly.',
      icon: <MessageSquare size={22} color="#7AA8FF" />,
      accent: '#7AA8FF',
    },
    {
      title: 'Appropriate automation',
      desc: 'We automate high-value, repetitive workflows that eliminate human error, while avoiding brittle, over-engineered pipelines that add unnecessary operational friction.',
      icon: <Terminal size={22} color="#38D9FF" />,
      accent: '#38D9FF',
    },
    {
      title: 'Measured performance & cost',
      desc: 'Every architecture decision is benchmarked against real telemetry and cost efficiency. We actively reclaim idle spend and right-size capacity.',
      icon: <Gauge size={22} color="#7AA8FF" />,
      accent: '#7AA8FF',
    },
    {
      title: 'Solutions aligned with business requirements',
      desc: 'We design cloud systems to match your team’s scale, engineering capability, and business goals—never selling complex stacks you do not need.',
      icon: <Target size={22} color="#10B981" />,
      accent: '#10B981',
    },
  ];

  return (
    <section id="principles" className="section section-alt" aria-label="Engineering Principles">
      <div className="container">
        {/* Section Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>CORE VALUES &amp; STANDARDS</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            Built on uncompromising engineering principles.
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            We adhere to rigorous technical disciplines that ensure cloud platforms remain secure,
            maintainable, and predictable under high demand.
          </p>
        </div>

        {/* 6 Principles Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px',
          }}
          className="principles-grid"
        >
          {principles.map((item, idx) => (
            <div
              key={idx}
              style={{
                background: 'rgba(16, 27, 43, 0.65)',
                backdropFilter: 'blur(12px)',
                borderRadius: '14px',
                border: '1px solid var(--border-subtle)',
                padding: '30px 24px',
                display: 'flex',
                flexDirection: 'column',
                transition: 'all var(--transition-norm)',
              }}
              className="card-glass"
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = item.accent;
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: `${item.accent}15`,
                  border: `1px solid ${item.accent}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '18px',
                }}
              >
                {item.icon}
              </div>

              <h3
                style={{
                  fontSize: '1.12rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '10px',
                  letterSpacing: '-0.01em',
                }}
              >
                {item.title}
              </h3>

              <p
                style={{
                  fontSize: '0.88rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                }}
              >
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .principles-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .principles-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
