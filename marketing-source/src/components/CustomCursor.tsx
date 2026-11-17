import React, { useEffect, useState, useRef } from 'react';

export const CustomCursor: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [visible, setVisible] = useState(false);

  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  const mousePos = useRef({ x: -100, y: -100 });
  const ringPos = useRef({ x: -100, y: -100 });
  const animationFrameId = useRef<number | null>(null);

  useEffect(() => {
    // Check if device has fine pointer (desktop mouse)
    const mediaQuery = window.matchMedia('(pointer: fine)');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!mediaQuery.matches || prefersReducedMotion.matches) {
      return;
    }

    setEnabled(true);
    document.body.classList.add('custom-cursor-active');

    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
      if (!visible) setVisible(true);

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      }
    };

    const handleMouseDown = () => setClicked(true);
    const handleMouseUp = () => setClicked(false);

    const handleMouseLeave = () => setVisible(false);
    const handleMouseEnter = () => setVisible(true);

    const checkHoverTarget = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const interactive = target.closest(
        'a, button, [role="button"], input, textarea, select, .interactive-glow, .node-tag, .tilt-card-wrapper'
      );
      setHovered(!!interactive);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseover', checkHoverTarget, { passive: true });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);
    document.documentElement.addEventListener('mouseenter', handleMouseEnter);

    // Spring/lerp loop for trailing ring
    const renderLoop = () => {
      // Lerp ring towards mouse position: ring += (target - ring) * 0.16
      ringPos.current.x += (mousePos.current.x - ringPos.current.x) * 0.18;
      ringPos.current.y += (mousePos.current.y - ringPos.current.y) * 0.18;

      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ringPos.current.x}px, ${ringPos.current.y}px, 0) translate(-50%, -50%)`;
      }

      animationFrameId.current = requestAnimationFrame(renderLoop);
    };

    animationFrameId.current = requestAnimationFrame(renderLoop);

    return () => {
      document.body.classList.remove('custom-cursor-active');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseover', checkHoverTarget);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
      document.documentElement.removeEventListener('mouseenter', handleMouseEnter);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [visible]);

  if (!enabled) return null;

  return (
    <>
      <div
        ref={dotRef}
        className="custom-cursor-dot"
        style={{ opacity: visible ? 1 : 0 }}
        aria-hidden="true"
      />
      <div
        ref={ringRef}
        className={`custom-cursor-ring ${hovered ? 'cursor-hover' : ''} ${clicked ? 'cursor-active' : ''}`}
        style={{ opacity: visible ? 1 : 0 }}
        aria-hidden="true"
      />
    </>
  );
};
