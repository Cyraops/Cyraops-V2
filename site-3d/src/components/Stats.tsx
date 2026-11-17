import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

/**
 * Count-up stats, triggered the first time they enter the viewport.
 *
 * Genomines' "-40% / 70M+ / -45 tons" is the same pattern; ours use the numbers
 * the site actually claims, so the flourish never promises more than the copy.
 */

interface Stat {
  value: number;
  suffix?: string;
  prefix?: string;
  label: string;
}

export function Stats({ stats }: { stats: Stat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  // Start at the real numbers, not at zero: a crawler, a reader with JS off, or
  // a prerendered snapshot must never see "0 offerings". The count-up is an
  // enhancement that runs only once the block is on screen.
  const [values, setValues] = useState<number[]>(() => stats.map((stat) => stat.value));

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1400;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValues(stats.map((stat) => stat.value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, stats]);

  return (
    <div className="stats" ref={ref}>
      {stats.map((stat, index) => (
        <div className="stat" key={stat.label}>
          <span className="stat-value">
            {stat.prefix}
            {Math.round(values[index])}
            {stat.suffix}
          </span>
          <span className="stat-label">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
