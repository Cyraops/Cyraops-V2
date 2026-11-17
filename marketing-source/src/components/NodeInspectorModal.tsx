import React from 'react';
import { X, CheckCircle, ArrowRight, ShieldCheck, Activity } from 'lucide-react';
import type { HeroInfraNode } from './HeroInfrastructure3D';

interface NodeInspectorModalProps {
  node: HeroInfraNode | null;
  onClose: () => void;
  onInquire: (nodeName: string) => void;
}

export const NodeInspectorModal: React.FC<NodeInspectorModalProps> = ({
  node,
  onClose,
  onInquire,
}) => {
  if (!node) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(6, 10, 18, 0.78)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-node-title"
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '500px',
          background: 'rgba(17, 28, 48, 0.96)',
          borderRadius: '16px',
          border: `1px solid ${node.color}50`,
          boxShadow: `0 24px 60px rgba(0, 0, 0, 0.8), 0 0 30px ${node.color}25`,
          padding: '30px',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            color: 'var(--text-muted)',
            padding: '6px',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
          aria-label="Close inspector"
        >
          <X size={20} />
        </button>

        {/* Node Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: node.color,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            INFRASTRUCTURE NODE &middot; {node.name}
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '100px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              fontSize: '0.68rem',
              fontWeight: 600,
              color: '#10B981',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10B981' }} />
            {node.status.toUpperCase()}
          </span>
        </div>

        {/* Title */}
        <h3
          id="modal-node-title"
          style={{
            fontSize: '1.45rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            marginBottom: '12px',
          }}
        >
          {node.name}
        </h3>

        {/* Detail */}
        <p
          style={{
            fontSize: '0.94rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: '24px',
          }}
        >
          {node.detail}
        </p>

        {/* Operational Focus Box */}
        <div
          style={{
            background: 'rgba(11, 18, 32, 0.75)',
            borderRadius: '10px',
            padding: '16px',
            border: '1px solid rgba(148, 163, 184, 0.12)',
            marginBottom: '24px',
            fontSize: '0.84rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.70rem',
              fontWeight: 700,
              color: 'var(--accent-cyan)',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}
          >
            OPERATIONAL STEWARDSHIP SCOPE
          </div>
          Continuous health checks, automated CloudWatch threshold alarms, right-sizing reviews, and verified backup retention.
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '10px 18px', fontSize: '0.86rem' }}>
            Close Inspector
          </button>
          <button
            onClick={() => {
              onInquire(node.name);
              onClose();
            }}
            className="btn btn-primary"
            style={{ padding: '10px 20px', fontSize: '0.86rem' }}
          >
            Inquire About {node.name}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};
