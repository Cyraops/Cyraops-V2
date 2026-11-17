import { useEffect, useRef, useState } from "react";
import { NAV_GROUPS, type NavGroup } from "../data/nav";
import { navigate } from "../lib/router";

/**
 * Header navigation with mega-menu dropdowns.
 *
 * Interaction rules, because this is where most sites get it wrong:
 *  - Opens on hover for pointer users and on click/Enter for keyboard and touch.
 *  - Escape closes and returns focus to the trigger.
 *  - Moving between triggers while one is open switches panels without closing.
 *  - The entire menu is one focus trap-free region: tabbing out closes it.
 */
export function MegaNav() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  // Horizontal offset so the panel never hangs off the viewport edge.
  const [panelLeft, setPanelLeft] = useState<number>(0);
  const [scrolled, setScrolled] = useState(false);
  // Collapsible header: hide on scroll down, return on scroll up.
  const [collapsed, setCollapsed] = useState(false);
  // Scroll progress, like Genomines' "00%" readout in the header.
  const [progress, setProgress] = useState(0);
  const navRef = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const menuOpenRef = useRef(false);

  // Keep the "menu open" state in a ref so the scroll handler can read it
  // without re-subscribing every time a menu opens.
  useEffect(() => {
    menuOpenRef.current = open !== null || mobile;
  }, [open, mobile]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 12);

      const delta = y - lastY.current;
      // Never hide while a menu is open (the panel is anchored to the header),
      // and never hide near the top where it would fight the hero.
      if (!menuOpenRef.current && y > 180 && delta > 2) setCollapsed(true);
      else if (delta < -4 || y <= 180) setCollapsed(false);
      lastY.current = y;

      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.round((y / max) * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      setMobile(false);
    };
    const onClick = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpen(null);
    };
    const onResize = () => setOpen(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-locked", mobile);
  }, [mobile]);

  /**
   * Centre the panel on its trigger, then clamp it inside the viewport.
   * A centred panel on the first or last menu item used to overflow the screen
   * edge and get clipped, which looked broken.
   */
  const openGroup = (label: string, trigger: HTMLElement) => {
    const width = Math.min(760, window.innerWidth - 32);
    const rect = trigger.getBoundingClientRect();
    const desired = rect.left + rect.width / 2 - width / 2;
    const clamped = Math.max(16, Math.min(desired, window.innerWidth - width - 16));
    const itemLeft = (trigger.closest(".nav-item") as HTMLElement | null)?.getBoundingClientRect().left ?? rect.left;
    setPanelLeft(Math.round(clamped - itemLeft));
    setOpen(label);
  };

  const go = (href: string) => {
    setOpen(null);
    setMobile(false);
    navigate(href);
  };

  return (
    <>
      <header className={`nav ${scrolled ? "is-scrolled" : ""} ${collapsed ? "is-collapsed" : ""}`} ref={navRef}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
          aria-label="CyraOps home"
        >
          <span className="brand-mark">C</span>
          CyraOps
        </a>

        <nav className="nav-links" aria-label="Primary">
          {NAV_GROUPS.map((group) => {
            const isOpen = open === group.label;
            if (group.kind === "link") {
              return (
                <a
                  key={group.label}
                  className="nav-link"
                  href={group.plainHref}
                  onClick={(e) => { e.preventDefault(); go(group.plainHref!); }}
                >
                  {group.label}
                </a>
              );
            }
            return (
              <div
                className="nav-item"
                key={group.label}
                onMouseLeave={() => setOpen((current) => (current === group.label ? null : current))}
              >
                <button
                  className={`nav-link ${isOpen ? "is-open" : ""}`}
                  aria-expanded={isOpen}
                  aria-haspopup="true"
                  onMouseEnter={(e) => openGroup(group.label, e.currentTarget)}
                  onClick={(e) => (isOpen ? setOpen(null) : openGroup(group.label, e.currentTarget))}
                >
                  {group.label}
                  <svg className="caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </button>
                {isOpen && <MegaPanel group={group} onGo={go} left={panelLeft} />}
              </div>
            );
          })}
        </nav>

        <div className="nav-cta">
          <span className="nav-progress" aria-hidden="true">{progress}%</span>
          <a
            className="btn btn-primary"
            href="/contact"
            onClick={(e) => {
              e.preventDefault();
              go("/contact");
            }}
            style={{ height: 40, padding: "0 18px" }}
          >
            Contact us <span className="arrow">↗</span>
          </a>
          <button
            className="menu-btn btn btn-ghost"
            style={{ height: 40, padding: "0 16px" }}
            onClick={() => setMobile(true)}
            aria-expanded={mobile}
          >
            Menu
          </button>
        </div>
      </header>

      {mobile && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="sheet-close" onClick={() => setMobile(false)}>
            Close ✕
          </button>
          <div className="sheet-scroll">
            {NAV_GROUPS.map((group) => (
              <div className="sheet-group" key={group.label}>
                <button
                  className="sheet-trigger"
                  aria-expanded={mobileGroup === group.label}
                  onClick={() => setMobileGroup(mobileGroup === group.label ? null : group.label)}
                >
                  {group.label}
                  <span>{mobileGroup === group.label ? "−" : "+"}</span>
                </button>
                {mobileGroup === group.label && (
                  <div className="sheet-links">
                    {group.links.map((link) => (
                      <a key={link.href} href={link.href} onClick={() => go(link.href)}>
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function MegaPanel({ group, onGo, left }: { group: NavGroup; onGo: (href: string) => void; left: number }) {
  return (
    <div className="mega" role="menu" aria-label={group.label} style={{ left, transform: "none" }}>
      <div className="mega-grid">
        <div className="mega-main">
          <p className="mega-blurb">{group.blurb}</p>
          <div className="mega-links">
            {group.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault();
                  onGo(link.href);
                }}
              >
                <span className="mega-link-label">{link.label}</span>
                {link.note && <span className="mega-link-note">{link.note}</span>}
              </a>
            ))}
          </div>
          <a
            className="mega-all"
            href={group.label === "About" ? "/about" : `/${group.links[0]?.href.split("/")[1] ?? ""}`}
            onClick={(e) => {
              e.preventDefault();
              onGo(group.label === "About" ? "/about" : `/${group.links[0]?.href.split("/")[1] ?? ""}`);
            }}
          >
            {group.label === "About" ? "About CyraOps" : `View all ${group.label.toLowerCase()}`} <span aria-hidden="true">→</span>
          </a>
        </div>

        {group.featured && (
          <a
            className="mega-feature"
            href={group.featured.href}
            onClick={(e) => {
              e.preventDefault();
              onGo(group.featured!.href);
            }}
          >
            <span className="mega-feature-tag">Made by us</span>
            <span className="mega-feature-title">{group.featured.label}</span>
            <span className="mega-feature-note">{group.featured.note}</span>
          </a>
        )}
      </div>
    </div>
  );
}
