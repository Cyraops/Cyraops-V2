import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/* ------------------------------------------------------------------ nav ---- */

export function Nav({ links }: { links: { label: string; href: string }[] }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Highlight the section currently in the viewport, not just on click.
  useEffect(() => {
    const ids = links.map((l) => l.href.replace("#", ""));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [links]);

  useEffect(() => {
    document.body.classList.toggle("is-locked", open);
  }, [open]);

  return (
    <>
      <header className={`nav ${scrolled ? "is-scrolled" : ""}`}>
        <a className="brand" href="#top" aria-label="CyraOps home">
          <span className="brand-mark">C</span>
          CyraOps
        </a>

        <nav className="nav-links" aria-label="Sections">
          {links.map((link) => (
            <a key={link.href} className={`nav-link ${active === link.href ? "is-active" : ""}`} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-cta">
          <a className="btn btn-primary" href="#contact" style={{ height: 40, padding: "0 18px" }}>
            Talk to us <span className="arrow">↗</span>
          </a>
          <button className="menu-btn btn btn-ghost" style={{ height: 40, padding: "0 16px" }} onClick={() => setOpen(true)}>
            Menu
          </button>
        </div>
      </header>

      {open && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="sheet-close" onClick={() => setOpen(false)}>
            Close ✕
          </button>
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href="#contact" onClick={() => setOpen(false)}>
            Contact
          </a>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- cursor ---- */

export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    if (window.matchMedia("(max-width: 860px)").matches) return;

    // One cursor, not two: hide the native one only while this is mounted, and
    // give it back on unmount so a JS failure can never leave you without a pointer.
    document.documentElement.classList.add("has-custom-cursor");

    let visible = false;
    const place = (event: PointerEvent) => {
      if (!dot.current) return;
      // Exact tracking — no easing. A lagging dot reads as a broken cursor
      // because it visibly disagrees with the pointer you are actually moving.
      dot.current.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%)`;
      if (!visible) {
        visible = true;
        dot.current.style.opacity = "1";
      }
      const interactive = (event.target as HTMLElement)?.closest?.("a, button, .axis-item, .card, .problem-card, .axis-card");
      dot.current.classList.toggle("is-hover", Boolean(interactive));
    };
    const hide = () => {
      if (dot.current) dot.current.style.opacity = "0";
      visible = false;
    };

    window.addEventListener("pointermove", place, { passive: true });
    window.addEventListener("pointerdown", place, { passive: true });
    document.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);

    return () => {
      document.documentElement.classList.remove("has-custom-cursor");
      window.removeEventListener("pointermove", place);
      window.removeEventListener("pointerdown", place);
      document.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, [reduced]);

  if (reduced) return null;
  return <div className="cursor" ref={dot} aria-hidden="true" style={{ opacity: 0 }} />;
}

/* --------------------------------------------------------------- reveal ---- */

export function Reveal({
  children,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  as?: "div" | "section";
}) {
  const Tag = motion[as];
  return (
    <Tag
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.75, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------- marquee ---- */

export function Marquee({ items, speedRef }: { items: string[]; speedRef?: React.MutableRefObject<number> }) {
  const doubled = [...items, ...items];
  const trackRef = useRef<HTMLDivElement>(null);

  // The marquee leans into scroll velocity, so the page surface feels alive
  // rather than running a fixed loop.
  useEffect(() => {
    if (!speedRef) return;
    let raf = 0;
    let pos = 0;
    const loop = () => {
      const speed = speedRef.current ?? 1;
      pos = (pos + 0.35 * speed) % 100;
      if (trackRef.current) {
        trackRef.current.style.animationDuration = `${38 / speed}s`;
        trackRef.current.style.transform = `translateX(${pos}%)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speedRef]);

  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track" ref={trackRef}>
        {doubled.map((item, index) => (
          <span className="marquee-item" key={`${item}-${index}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
