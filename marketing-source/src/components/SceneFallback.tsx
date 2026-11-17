import React from 'react';
import { Server, Shield, Cpu, Database, Network } from 'lucide-react';

interface SceneFallbackProps {
  onSelectNode?: (nodeId: string) => void;
}

export const SceneFallback: React.FC<SceneFallbackProps> = ({ onSelectNode }) => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '440px',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '16px',
        background: 'radial-gradient(ellipse at 50% 50%, rgba(16, 27, 43, 0.8) 0%, rgba(5, 9, 18, 0.95) 100%)',
        border: '1px solid rgba(150, 190, 220, 0.16)',
        overflow: 'hidden',
        padding: '32px',
      }}
      role="region"
      aria-label="Cloud Infrastructure Visualization Fallback"
    >
      {/* Subtle planetary horizon arc */}
      <div
        style={{
          position: 'absolute',
          bottom: '-120px',
          width: '140%',
          height: '240px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(56, 217, 255, 0.08) 0%, transparent 70%)',
          borderTop: '1px solid rgba(56, 217, 255, 0.25)',
          pointerEvents: 'none',
        }}
      />

      {/* Cloud silhouette container */}
      <div
        style={{
          position: 'relative',
          width: '320px',
          height: '220px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Soft glowing ambient cloud glow */}
        <div
          style={{
            position: 'absolute',
            width: '260px',
            height: '140px',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(56, 217, 255, 0.18) 0%, rgba(122, 168, 255, 0.06) 60%, transparent 80%)',
            filter: 'blur(20px)',
            pointerEvents: 'none',
          }}
        />

        {/* Central architectural core representation */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            padding: '20px 24px',
            borderRadius: '12px',
            background: 'rgba(16, 27, 43, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(56, 217, 255, 0.3)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <Server size={18} color="#38D9FF" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                fontWeight: 700,
                color: '#F4F7FB',
                letterSpacing: '0.08em',
              }}
            >
              CYRAOPS INFRASTRUCTURE CORE
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#A7B5C8', margin: 0 }}>
            Active Multi-Region Cluster &middot; Operational
          </p>
        </div>

        {/* Orbital Node Badges */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            justifyContent: 'center',
            marginTop: '20px',
            position: 'relative',
            zIndex: 3,
          }}
        >
          {[
            { id: 'compute', label: 'Compute Fleet', icon: <Cpu size={14} color="#38D9FF" /> },
            { id: 'storage', label: 'Secure Storage', icon: <Database size={14} color="#7AA8FF" /> },
            { id: 'networking', label: 'Transit Network', icon: <Network size={14} color="#38D9FF" /> },
            { id: 'security', label: 'Zero-Trust IAM', icon: <Shield size={14} color="#10B981" /> },
          ].map(node => (
            <button
              key={node.id}
              onClick={() => onSelectNode && onSelectNode(node.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'rgba(10, 18, 32, 0.85)',
                border: '1px solid rgba(150, 190, 220, 0.2)',
                fontSize: '0.75rem',
                color: '#F4F7FB',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#38D9FF';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(150, 190, 220, 0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {node.icon}
              {node.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
