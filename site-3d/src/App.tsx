import { Suspense, lazy, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import catalog from "./data/catalog.json";
import { Cursor, Marquee, Reveal } from "./components/Chrome";
import { Stats } from "./components/Stats";
import { MegaNav } from "./components/MegaNav";
import { AboutPage, AxisPage, CataloguePage, ContactPage, NotFound, OfferingPage } from "./components/Pages";
import { NAV_GROUPS, ALL_OFFERINGS } from "./data/nav";
import { navigate, segments, useRoute, useScrollTopOnRouteChange } from "./lib/router";
import { applyMeta } from "./lib/meta";

const Hero3D = lazy(() => import("./components/Hero3D").then((m) => ({ default: m.Hero3D })));

type Axis = { axis: string; label: string; intro: { eyebrow: string; sub: string }; items: Array<{ name: string }> };
const axes = (catalog as any).axes as Axis[];

const MARQUEE = [
  "Data strategy", "ML engineering", "Agentic workflows", "Data platforms", "MLOps",
  "Computer vision", "Cloud architecture", "Managed operations", "Business intelligence", "Governance",
];

export default function App() {
  const path = useRoute();

  // Title, canonical and structured data follow the route.
  useEffect(() => applyMeta(path), [path]);
  useScrollTopOnRouteChange(path);
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.05, smoothWheel: true, touchMultiplier: 1.4 });
    lenisRef.current = lenis;
    let raf = 0;
    const loop = (time: number) => { lenis.raf(time); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); lenisRef.current = null; };
  }, []);

  const [first, second] = segments(path);

  let page: React.ReactNode;
  if (!first) page = <Home lenisRef={lenisRef} />;
  else if (first === "catalogue") page = <CataloguePage />;
  else if (first === "contact") page = <ContactPage />;
  else if (first === "about") page = <AboutPage section={second} />;
  else if (axes.some((axis) => axis.axis === first)) page = second ? <OfferingPage axisId={first} itemSlug={second} /> : <AxisPage axisId={first} />;
  else page = <NotFound />;

  return (
    <div className="grain">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById("main"); m?.setAttribute("tabindex", "-1"); m?.focus(); }}>Skip to content</a>
      <Cursor />
      <MegaNav />
      <main id="main" tabIndex={-1}>{page}</main>
      <Footer />
    </div>
  );
}

function Home({ lenisRef }: { lenisRef: React.MutableRefObject<Lenis | null> }) {
  const [scrollP, setScrollP] = useState(0);
  const marqueeSpeed = useRef(1);

  useEffect(() => {
    let lastY = window.scrollY;
    let lastT = performance.now();
    let vel = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const now = performance.now();
      const dt = Math.max(16, now - lastT);
      vel = (y - lastY) / dt; // px/ms, sign = direction
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollP(max > 0 ? Math.min(1, y / max) : 0);
      // Feed the marquee a velocity so it leans into your scroll, like a live surface.
      marqueeSpeed.current = Math.max(0.4, 1 + Math.abs(vel) * 0.06);
      lastY = y;
      lastT = now;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const heroExit = {
    opacity: Math.max(0, 1 - scrollP * 1.7),
    transform: `translateY(${scrollP * -40}px) scale(${1 - scrollP * 0.04})`,
  };

  const jump = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    // Real paths route through the router; bare fragments scroll in-page.
    if (href.startsWith("/")) { event.preventDefault(); navigate(href); return; }
    if (!href.startsWith("#")) return;
    const el = document.querySelector(href);
    if (!el) return;
    event.preventDefault();
    if (lenisRef.current) lenisRef.current.scrollTo(el as HTMLElement, { offset: -70 });
    else el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <div className="scrollbar"><div className="scrollbar-track"><div className="scrollbar-fill" style={{ transform: `scaleX(${scrollP})` }} /></div></div>
      <section className="hero" id="top">
        <Suspense fallback={<div className="hero-fallback" />}>
          <Hero3D />
        </Suspense>
        <div className="hero-scrim" aria-hidden="true" />
        <div className="shell hero-inner" style={heroExit}>
          <div className="hero-grid">
            <div>
              <span className="eyebrow">Data, AI and the platform underneath</span>
              <h1 className="display hero-title">Pilots are easy.<br /><em>Production</em> is<br />the hard part.</h1>
              <p className="lead hero-sub">We build the data platforms, models and applications that survive real use — and we stay to run them. One small senior team, from the first pipeline to the incident at 2am.</p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="/contact" onClick={(e) => jump(e, "/contact")}>Start a conversation <span className="arrow">↗</span></a>
                <a className="btn btn-ghost" href="/catalogue" onClick={(e) => jump(e, "/catalogue")}>See the catalogue</a>
              </div>
            </div>

          </div>
        </div>
        <div className="hero-scroll"><i /> Scroll</div>
      </section>

      <Marquee items={MARQUEE} speedRef={marqueeSpeed} />

      <section className="section" id="problem">
        <div className="shell">
          <Reveal>
            <span className="eyebrow">Where it goes wrong</span>
            <h2 className="h2" style={{ marginTop: 18, maxWidth: "24ch" }}>Most data and AI work dies <em>after</em> the demo.</h2>
          </Reveal>
          <div className="problem-grid">
            {[
              ["The pilot that never ships", "A notebook proves the idea. Nobody owns the pipeline, the retraining or the monitoring, so it never becomes a product.", "solutions"],
              ["The platform nobody owns", "Pipelines break silently, definitions disagree, and dashboards get abandoned. The team moves on and the estate rots.", "ai-foundation"],
              ["The bill that creeps", "Cloud spend grows without attribution, and nobody can say what a workload costs or what it earns.", "functions"],
            ].map(([title, body, axis], i) => (
              <Reveal key={title} delay={i * 0.06}>
                <a className="problem-card" href={`/${axis}`} onClick={(e) => jump(e, `/${axis}`)}>
                  <span className="problem-num">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="problem-title">{title}</h3>
                  <p className="problem-body">{body}</p>
                  <span className="problem-link">How we fix it →</span>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section stats-section" id="stats" aria-label="The catalogue at a glance">
        <div className="shell">
          <Reveal>
            <Stats stats={[
              { value: ALL_OFFERINGS.length, label: "offerings in the catalogue" },
              { value: axes.length, label: "ways in — solution to industry" },
              { value: 1, label: "product we build and run" },
              { value: 4, label: "steps, scope to running it" },
            ]} />
          </Reveal>
        </div>
      </section>

      <section className="section" id="explore">
        <div className="shell">
          <Reveal>
            <span className="eyebrow">The catalogue</span>
            <h2 className="h2" style={{ marginTop: 18, maxWidth: "20ch" }}>Different buyers.<br /><em>One</em> team.</h2>
          </Reveal>
          <div className="axis-cards">
            {axes.map((axis, index) => (
              <Reveal key={axis.axis} delay={index * 0.04}>
                <a className="axis-card" href={`/${axis.axis}`} onClick={(e) => jump(e, `/${axis.axis}`)}>
                  <span className="axis-card-num">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="axis-card-title">{axis.label}</h3>
                  <p className="axis-card-sub">{axis.intro.sub}</p>
                  <span className="axis-card-count">{axis.items.length} offerings →</span>
                </a>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.1}>
            <p className="body" style={{ marginTop: 28, maxWidth: "62ch" }}>
              A CDO arrives through the platform, a CFO through the function, a CTO through the expertise. It is the same engineers either way — which is why we can build something and still be the ones running it a year later.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="proof section" id="proof">
        <div className="shell split">
          <div>
            <Reveal>
              <span className="eyebrow">Why CyraOps</span>
              <h2 className="h2" style={{ marginTop: 18 }}>We run<br />what we <em>sell.</em></h2>
              <p className="body" style={{ marginTop: 22, maxWidth: "44ch" }}>
                CyraOps CRM is our own product: an operations platform with an agent runtime, running daily on the same stack we build for clients. It has approvals, run history, replay and a cost ceiling because it had to have them in production. When we argue about what a system needs before you trust it, that is where the argument comes from.
              </p>
              <a className="link-underline" href="/about" onClick={(e) => jump(e, "/about")} style={{ marginTop: 26, color: "var(--lime)" }}>About the practice</a>
            </Reveal>
          </div>
          <div className="proof-facts">
            {[
              "Our own product in production, not a demo",
              "Data, AI and infrastructure under one team",
              "You keep ownership of everything we build",
              "Same people scope it, build it and run it",
            ].map((fact, i) => (
              <Reveal key={fact} delay={i * 0.06}>
                <div className="proof-fact"><span>{String(i + 1).padStart(2, "0")}</span><p style={{ margin: 0 }}>{fact}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Footer() {
  const axisGroups = NAV_GROUPS.filter((g) => g.kind === "group" && g.label !== "About");
  const about = NAV_GROUPS.find((g) => g.label === "About");
  const go = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); navigate(href); };

  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-col">
            <a className="brand" href="/" onClick={go("/")} style={{ marginBottom: 12 }}><span className="brand-mark">C</span> CyraOps</a>
            <p className="small" style={{ maxWidth: "26ch" }}>Data, AI and platform engineering. Built, then operated.</p>
          </div>
          {axisGroups.slice(0, 4).map((group) => (
            <div className="footer-col" key={group.label}>
              <h4>{group.label}</h4>
              {group.links.map((link) => (<a key={link.href} href={link.href} onClick={go(link.href)}>{link.label}</a>))}
            </div>
          ))}
        </div>

        <div className="footer-grid footer-grid-2">
          {axisGroups.slice(4).map((group) => (
            <div className="footer-col" key={group.label}>
              <h4>{group.label}</h4>
              {group.links.map((link) => (<a key={link.href} href={link.href} onClick={go(link.href)}>{link.label}</a>))}
            </div>
          ))}
          <div className="footer-col">
            <h4>{about?.label}</h4>
            {about?.links.map((link) => (<a key={link.href} href={link.href} onClick={go(link.href)}>{link.label}</a>))}
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <a href="/catalogue" onClick={go("/catalogue")}>Full catalogue</a>
            <a href="/contact" onClick={go("/contact")}>Contact</a>
          </div>
          <div className="footer-col">
            <h4>Elsewhere</h4>
            <a href="mailto:hello@cyraops.com">hello@cyraops.com</a>
            <a href="https://www.cyraops.com/">www.cyraops.com</a>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} CyraOps</span>
          <span>Data, AI and platform engineering</span>
        </div>
      </div>
    </footer>
  );
}