import React, { useEffect, useState } from 'react';
import { COMPANY_NAME } from '../constants/content';
import { Cloud } from 'lucide-react';

interface LoadingScreenProps {
  onLoaded: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ onLoaded }) => {
  const [progress, setProgress] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const duration = 1400;
    const start = Date.now();

    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(elapsed / duration, 1);
      setProgress(Math.round(p * 100));

      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        setFading(true);
        setTimeout(onLoaded, 400);
      }
    };

    requestAnimationFrame(tick);
  }, [onLoaded]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--navy)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease',
        pointerEvents: fading ? 'none' : 'all',
      }}
      aria-label="Loading"
      aria-live="polite"
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Cloud size={24} color="rgba(255,255,255,0.85)" strokeWidth={1.75} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: '4px' }}>
          {COMPANY_NAME}
        </p>
        <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
          Managed AWS Cloud Operations
        </p>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: '200px',
          height: '2px',
          borderRadius: '1px',
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
        aria-hidden="true"
      >
        <div
          style={{
            height: '100%',
            background: 'rgba(147,197,253,0.7)',
            borderRadius: '1px',
            width: `${progress}%`,
            transition: 'width 0.06s linear',
          }}
        />
      </div>
    </div>
  );
};
