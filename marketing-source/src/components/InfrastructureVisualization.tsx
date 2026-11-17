import React, { useState } from 'react';
import { Layers, Server, HardDrive, Network, Activity, Shield, ArrowRight, CheckCircle2 } from 'lucide-react';

export const InfrastructureVisualization: React.FC = () => {
  const [selectedLayer, setSelectedLayer] = useState<string>('compute');

  const layers = [
    {
      id: 'applications',
      name: '01 / Applications & Ingress',
      short: 'Applications',
      icon: <Layers size={20} color="#38D9FF" />,
      color: '#38D9FF',
      role: 'Client Traffic & Frontend Services',
      details: 'Microservices, API Gateways, Next.js / React frontends, and containerized backend workloads receiving client queries via global edge points.',
      connections: ['networking', 'compute'],
      metrics: ['Sub-20ms edge response', 'Anycast TLS termination', 'Auto-scaling pods'],
    },
    {
      id: 'networking',
      name: '02 / Networking & Mesh',
      short: 'Networking',
      icon: <Network size={20} color="#7AA8FF" />,
      color: '#7AA8FF',
      role: 'Traffic Routing & Service Mesh',
      details: 'Encrypted VPC transit networks, Route 53 global DNS, CloudFront CDN, and service mesh discovery coordinating low-latency cluster communications.',
      connections: ['applications', 'compute', 'security'],
      metrics: ['Redundant Transit Gateways', 'Zero-Packet Loss Routing', 'Multi-AZ peering'],
    },
    {
      id: 'compute',
      name: '03 / Compute & Runtimes',
      short: 'Compute',
      icon: <Server size={20} color="#38D9FF" />,
      color: '#38D9FF',
      role: 'Workload Execution & Elastic Fleets',
      details: 'Kubernetes (EKS/GKE), ECS task fleets, and event-driven serverless functions autoscaling horizontally according to realtime CPU/memory telemetry.',
      connections: ['applications', 'storage', 'monitoring', 'security'],
      metrics: ['Horizontal Pod Autoscaling', 'Arm64 Graviton efficiency', 'Sub-second cold starts'],
    },
    {
      id: 'storage',
      name: '04 / Storage & Datastores',
      short: 'Storage',
      icon: <HardDrive size={20} color="#7AA8FF" />,
      color: '#7AA8FF',
      role: 'Persistent State & High-IOPS Disks',
      details: 'Clustered Aurora PostgreSQL, Redis in-memory caching tiers, S3 encrypted object lakes, and high-IOPS NVMe persistent storage volumes.',
      connections: ['compute', 'monitoring', 'security'],
      metrics: ['99.999999999% durability', 'Automated point-in-time recovery', 'AES-256 KMS encryption'],
    },
    {
      id: 'monitoring',
      name: '05 / Observability & Telemetry',
      short: 'Monitoring',
      icon: <Activity size={20} color="#10B981" />,
      color: '#10B981',
      role: 'Distributed Tracing & Realtime Alerts',
      details: 'Unified OpenTelemetry distributed tracing, Prometheus time-series metrics, Datadog dashboards, and automated anomaly detection alerts.',
      connections: ['applications', 'compute', 'storage', 'networking'],
      metrics: ['Realtime MTTR alerts', 'P99 latency tracking', 'Continuous synthetic health probes'],
    },
    {
      id: 'security',
      name: '06 / Security & Zero-Trust IAM',
      short: 'Security',
      icon: <Shield size={20} color="#10B981" />,
      color: '#10B981',
      role: 'Governance & Cryptographic Isolation',
      details: 'Short-lived STS token policies, hardware KMS key enclaves, continuous configuration drift guardrails, and automated SOC2 / ISO27001 posture scanning.',
      connections: ['applications', 'networking', 'compute', 'storage', 'monitoring'],
      metrics: ['Least-privilege RBAC', 'Continuous CSPM posture auditing', 'Zero hardcoded secrets'],
    },
  ];

  const current = layers.find(l => l.id === selectedLayer) || layers[2];

  return (
    <section id="infrastructure" className="section section-alt" aria-label="Infrastructure Visualization">
      <div className="container">
        {/* Section Header */}
        <div className="section-head-center">
          <div className="eyebrow eyebrow-pill">
            <span className="eyebrow-dot" />
            <span>INTERCONNECTED ARCHITECTURE</span>
          </div>
          <h2 className="headline-lg" style={{ marginBottom: '16px' }}>
            Unified cloud infrastructure ecosystem.
          </h2>
          <p className="body-lead" style={{ margin: '0 auto' }}>
            Explore how modern cloud subsystems communicate seamlessly to maintain speed,
            security, and uninterrupted uptime.
          </p>
        </div>

        {/* Interactive Architecture Visualization Layout */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '36px',
            alignItems: 'center',
          }}
          className="infra-vis-grid"
        >
          {/* Left Column: Interactive Layer Graph */}
          <div
            style={{
              background: 'rgba(16, 27, 43, 0.7)',
              backdropFilter: 'blur(16px)',
              borderRadius: '18px',
              border: '1px solid var(--border-subtle)',
              padding: '32px 28px',
              boxShadow: 'var(--shadow-md)',
              position: 'relative',
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
                  color: 'var(--accent-cyan)',
                  letterSpacing: '0.08em',
                }}
              >
                LIVE SUBSYSTEM TOPOLOGY
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Select a layer to inspect data flow
              </span>
            </div>

            {/* Stacked Interactive Layer Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {layers.map(layer => {
                const isSelected = selectedLayer === layer.id;
                const isConnected = current.connections.includes(layer.id) || layer.id === current.id;
                return (
                  <button
                    key={layer.id}
                    onClick={() => setSelectedLayer(layer.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      textAlign: 'left',
                      background: isSelected
                        ? 'rgba(26, 42, 66, 0.95)'
                        : isConnected
                        ? 'rgba(16, 27, 43, 0.65)'
                        : 'rgba(10, 18, 32, 0.4)',
                      border: `1px solid ${
                        isSelected
                          ? layer.color
                          : isConnected
                          ? 'rgba(56, 217, 255, 0.35)'
                          : 'var(--border-subtle)'
                      }`,
                      boxShadow: isSelected ? `0 4px 16px rgba(0, 0, 0, 0.4), 0 0 12px ${layer.color}25` : 'none',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '8px',
                          background: `${layer.color}15`,
                          border: `1px solid ${layer.color}30`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {layer.icon}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: '0.94rem',
                            fontWeight: isSelected ? 700 : 600,
                            color: isSelected ? '#F4F7FB' : 'var(--text-secondary)',
                          }}
                        >
                          {layer.name}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {layer.role}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isConnected && !isSelected && (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.68rem',
                            color: 'var(--accent-cyan)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'rgba(56, 217, 255, 0.12)',
                          }}
                        >
                          ACTIVE LINK
                        </span>
                      )}
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isSelected ? layer.color : isConnected ? 'var(--accent-cyan)' : '#334155',
                          boxShadow: isSelected ? `0 0 8px ${layer.color}` : 'none',
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Layer Technical Inspector */}
          <div
            style={{
              background: 'rgba(16, 27, 43, 0.85)',
              backdropFilter: 'blur(16px)',
              borderRadius: '18px',
              border: `1px solid ${current.color}40`,
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
                  color: current.color,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                SUBSYSTEM TELEMETRY &middot; {current.short}
              </span>
            </div>

            <h3
              style={{
                fontSize: '1.65rem',
                fontWeight: 750,
                color: 'var(--text-primary)',
                marginBottom: '10px',
                letterSpacing: '-0.02em',
              }}
            >
              {current.role}
            </h3>

            <p
              style={{
                fontSize: '0.96rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.62,
                marginBottom: '28px',
              }}
            >
              {current.details}
            </p>

            {/* Performance Metrics */}
            <div
              style={{
                background: 'rgba(10, 18, 32, 0.7)',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid rgba(150, 190, 220, 0.12)',
                marginBottom: '28px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '12px',
                }}
              >
                Operational Performance Benchmarks
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {current.metrics.map((metric, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '0.88rem',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <CheckCircle2 size={16} color={current.color} style={{ flexShrink: 0 }} />
                    <span>{metric}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Connected Subsystems Tags */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '10px',
                }}
              >
                Direct Topology Couplings
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {current.connections.map(cId => {
                  const target = layers.find(l => l.id === cId);
                  return (
                    <span
                      key={cId}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        background: 'rgba(56, 217, 255, 0.1)',
                        border: '1px solid rgba(56, 217, 255, 0.25)',
                        fontSize: '0.76rem',
                        fontWeight: 600,
                        color: 'var(--accent-cyan)',
                      }}
                    >
                      &rarr; {target?.short || cId}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .infra-vis-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
