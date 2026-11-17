import React from 'react';
import { Cloud, GitBranch, ShieldAlert, Cpu, ArrowUpRight } from 'lucide-react';

interface CapabilitiesStripProps {
  onSelectService: (serviceKey: string) => void;
}

export const CapabilitiesStrip: React.FC<CapabilitiesStripProps> = ({ onSelectService }) => {
  const capabilities = [
    {
      id: 'cloud-engineering',
      name: 'Cloud Engineering',
      desc: 'Bespoke infrastructure architecture, multi-region resilience, and seamless cloud migrations.',
      icon: <Cloud size={24} color="#38D9FF" />,
      accent: '#38D9FF',
    },
    {
      id: 'devops-automation',
      name: 'DevOps Automation',
      desc: 'Continuous delivery pipelines, GitOps workflows, and complete Infrastructure-as-Code automation.',
      icon: <GitBranch size={24} color="#7AA8FF" />,
      accent: '#7AA8FF',
    },
    {
      id: 'managed-operations',
      name: 'Managed Cloud Operations',
      desc: '24/7 telemetry monitoring, preventative maintenance, incident response, and cost optimization.',
      icon: <Cpu size={24} color="#38D9FF" />,
      accent: '#38D9FF',
    },
    {
      id: 'cloud-security',
      name: 'Cloud Security',
      desc: 'Zero-trust IAM governance, continuous compliance auditing, automated backup, and disaster recovery.',
      icon: <ShieldAlert size={24} color="#10B981" />,
      accent: '#10B981',
    },
  ];

  return (
    <section
      id="capabilities"
      style={{
        position: 'relative',
        padding: '56px 0',
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(10, 18, 32, 0.65)',
        backdropFilter: 'blur(12px)',
      }}
      aria-label="Core Capabilities"
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '24px',
          }}
          className="capabilities-grid"
        >
          {capabilities.map(cap => (
            <button
              key={cap.id}
              onClick={() => onSelectService(cap.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                textAlign: 'left',
                padding: '24px 22px',
                borderRadius: '12px',
                background: 'rgba(16, 27, 43, 0.4)',
                border: '1px solid var(--border-subtle)',
                transition: 'all var(--transition-norm)',
                cursor: 'pointer',
                position: 'relative',
              }}
              className="card-glass"
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = cap.accent;
                e.currentTarget.style.transform = 'translateY(-3px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    background: `${cap.accent}15`,
                    border: `1px solid ${cap.accent}30`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {cap.icon}
                </div>
                <ArrowUpRight size={18} color="var(--text-muted)" />
              </div>

              <h3
                style={{
                  fontSize: '1.08rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '8px',
                  letterSpacing: '-0.01em',
                }}
              >
                {cap.name}
              </h3>

              <p
                style={{
                  fontSize: '0.84rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                }}
              >
                {cap.desc}
              </p>
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .capabilities-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .capabilities-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
