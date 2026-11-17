import React, { useState, useEffect } from 'react';
import { Menu, X, ArrowRight } from 'lucide-react';

interface NavigationProps {
  onHealthCheckClick: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ onHealthCheckClick }) => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');

  const navItems = [
    { label: 'SERVICES', id: 'services' },
    { label: 'HEALTH CHECK', id: 'health-check' },
    { label: 'HOW IT WORKS', id: 'how-we-work' },
    { label: 'FAQ', id: 'faq' },
    { label: 'CONTACT', id: 'contact' },
  ];

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 30);

      // Active section detection
      const sections = ['contact', 'faq', 'why-us', 'how-we-work', 'managed-care', 'optimize', 'health-check', 'services', 'problem', 'hero'];
      const scrollPos = window.scrollY + 200;

      for (const sectionId of sections) {
        const el = document.getElementById(sectionId);
        if (el && el.offsetTop <= scrollPos) {
          if (['services', 'health-check', 'how-we-work', 'faq', 'contact'].includes(sectionId)) {
            setActiveSection(sectionId);
          }
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        zIndex: 100,
        transition: 'all 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        background: scrolled
          ? 'rgba(6, 10, 18, 0.88)'
          : 'rgba(6, 10, 18, 0.4)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${scrolled ? 'rgba(148, 163, 184, 0.16)' : 'transparent'}`,
        transform: scrolled ? 'translateY(0)' : 'translateY(0)',
      }}
      role="banner"
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: scrolled ? '68px' : '76px',
          transition: 'height 0.28s ease',
        }}
      >
        {/* Brand Logo & Wordmark */}
        <a
          href="#"
          onClick={e => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
          aria-label="CyraOps Home"
        >
          <span className="brand-mark" aria-hidden="true"><img src="/cyraops-mark.png" alt="" /></span>

          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.02rem',
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: '#F8FAFC',
            }}
          >
            CYRA<span style={{ color: '#38D9FF', fontWeight: 600 }}>OPS</span>
          </span>
        </a>

        {/* Desktop Navigation Links */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '30px',
          }}
          className="desktop-nav"
          aria-label="Main navigation"
        >
          {navItems.map(link => {
            const isActive = activeSection === link.id;
            return (
              <button
                key={link.id}
                onClick={() => scrollToSection(link.id)}
                style={{
                  fontSize: '0.80rem',
                  fontWeight: 650,
                  letterSpacing: '0.08em',
                  color: isActive ? '#38D9FF' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  position: 'relative',
                  padding: '6px 0',
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.color = '#F8FAFC';
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                {isActive && (
                  <span
                    style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      background: '#38D9FF',
                      boxShadow: '0 0 6px #38D9FF',
                    }}
                  />
                )}
                <span>{link.label}</span>
              </button>
            );
          })}
        </nav>

        {/* CTA Button: GET A HEALTH CHECK */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={onHealthCheckClick}
            className="btn btn-primary"
            style={{
              padding: '9px 18px',
              fontSize: '0.82rem',
              letterSpacing: '0.04em',
            }}
          >
            GET A HEALTH CHECK
            <ArrowRight size={15} />
          </button>

          {/* Mobile Menu Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="mobile-toggle"
            style={{
              display: 'none',
              padding: '8px',
              color: 'var(--text-primary)',
              borderRadius: '6px',
            }}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div
          style={{
            background: 'rgba(6, 10, 18, 0.98)',
            borderBottom: '1px solid var(--border-subtle)',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
          role="navigation"
          aria-label="Mobile navigation drawer"
        >
          {navItems.map(link => (
            <button
              key={link.id}
              onClick={() => scrollToSection(link.id)}
              style={{
                textAlign: 'left',
                fontSize: '0.94rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: activeSection === link.id ? '#38D9FF' : 'var(--text-primary)',
                padding: '8px 0',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              {link.label}
            </button>
          ))}
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              onHealthCheckClick();
            }}
            className="btn btn-primary"
            style={{ marginTop: '8px', width: '100%', justifyContent: 'center' }}
          >
            GET A HEALTH CHECK
            <ArrowRight size={15} />
          </button>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          .desktop-nav {
            display: none !important;
          }
          .mobile-toggle {
            display: flex !important;
          }
        }
      `}</style>
    </header>
  );
};
