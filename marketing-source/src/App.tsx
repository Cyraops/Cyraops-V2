import React, { FormEvent, Fragment, Suspense, lazy, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react';
import { FAQ_CONTENT, FUNCTIONS_CONTENT, HOW_WE_WORK_CONTENT, INDUSTRIES_CONTENT, SERVICES_CONTENT } from './constants/content';

const OperationsCore3D = lazy(() => import('./components/OperationsCore3D').then(module => ({ default: module.OperationsCore3D })));
const AmbientField3D = lazy(() => import('./components/AmbientField3D').then(module => ({ default: module.AmbientField3D })));

type NavItem = { label: string; href: string };

const cmsUrl = import.meta.env.VITE_CMS_URL?.trim() || '/login';

const navItems: NavItem[] = [
  { label: 'Solutions', href: '#solutions' },
  { label: 'How we work', href: '#approach' },
  { label: 'Health check', href: '#health-check' },
  { label: 'Cloud care', href: '#managed-care' },
  { label: 'Our approach', href: '#approach' },
  { label: 'Cyraops CRM', href: cmsUrl },
];

const riskSignals = [
  ['01', 'Cloud spend without an owner', 'Idle compute, forgotten storage, and bills that drift a little higher each month.'],
  ['02', 'Data nobody trusts', 'Pipelines that break silently, definitions that disagree, and dashboards people quietly stop using.'],
  ['03', 'Models stuck in a notebook', 'Work that proved a point in analysis but was never deployed, monitored, or measured in production.'],
];

const costRows = [
  { name: 'Compute', old: 1420, next: 910 },
  { name: 'Storage', old: 680, next: 390 },
  { name: 'Database', old: 890, next: 640 },
  { name: 'Network', old: 410, next: 280 },
  { name: 'Monitoring', old: 240, next: 140 },
];

const careIncludes = [
  'Ongoing monitoring',
  'Monthly cloud-health review',
  'Cost optimization reviews',
  'Routine operational support',
  'Backup and snapshot checks',
  'Approved maintenance and troubleshooting',
  'Monthly reporting',
];

const principles = [
  {
    number: '01',
    title: 'A narrow, useful focus.',
    copy: 'We work across the stack: cloud foundations, the data pipelines on top, and the models that use them — built, then operated.',
  },
  {
    number: '02',
    title: 'Every change has context.',
    copy: 'Work is scoped and documented. Your team stays informed, keeps ownership, and knows what changed and why.',
  },
  {
    number: '03',
    title: 'Start with the smallest right step.',
    copy: 'A focused health check can surface priorities before you decide whether ongoing support makes sense.',
  },
];

type ContactFields = {
  name: string;
  email: string;
  company: string;
  environment: string;
  spend: string;
  helpTopic: string;
  website: string;
};

const blankContact: ContactFields = {
  name: '',
  email: '',
  company: '',
  environment: '',
  spend: '',
  helpTopic: '',
  website: '',
};

function BrandMark() {
  return (
    <a className="brand" href="#top" aria-label="CyraOps, home">
      <span className="brand-mark" aria-hidden="true">
        <img src="/cyraops-mark.png" alt="" />
      </span>
      <span className="brand-name">cyra<b>ops</b></span>
    </a>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <BrandMark />
        <nav className={`nav-links ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          {navItems.map(item => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>
          ))}
        </nav>
        <div className="header-actions">
          <a className="header-cta" href="#contact">Start a conversation <ArrowUpRight size={15} /></a>
          <button className="menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return <div className={`eyebrow ${light ? 'eyebrow-light' : ''}`}><span className="eyebrow-dot" />{children}</div>;
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-backdrop" aria-hidden="true" />
      <div className="hero-inner shell">
        <div className="hero-copy">
          <Eyebrow>DATA, AI &amp; PLATFORM ENGINEERING</Eyebrow>
          <h1>AI that reaches<br /><em>production.</em></h1>
          <p className="hero-intro">We build the data platforms and AI systems enterprises run on — and stay to operate them. Senior delivery, without the headcount.</p>
          <div className="hero-buttons">
            <a className="button button-primary" href="#contact">Talk to us <ArrowRight size={17} /></a>
            <a className="text-link" href="#solutions">See our solutions <ArrowDownRight size={16} /></a>
          </div>
          <div className="hero-reassurance"><span className="reassurance-icon"><Check size={13} /></span>Start with a fixed-scope review <i /> Keep full ownership</div>
        </div>
        <div className="hero-art-wrap" aria-hidden="true">
          <div className="hero-art">
            <Suspense fallback={<div className="operations-core core-fallback"><div className="fallback-core"><span /><i /><b /><em /></div></div>}>
              <OperationsCore3D />
            </Suspense>
          </div>
          <div className="hero-art-note"><span className="status-dot" />SOLUTIONS / FUNCTIONS / INDUSTRIES</div>
        </div>
        <div className="hero-index"><span>01</span><i /><span>04</span></div>
      </div>
      <a className="scroll-cue" href="#practice"><span>SCROLL TO EXPLORE</span><ChevronDown size={14} /></a>
    </section>
  );
}

function PracticeSection() {
  return (
    <section className="practice section-pad" id="practice">
      <div className="shell">
        <div className="practice-heading">
          <Eyebrow>WHERE LEAN TEAMS GET STUCK</Eyebrow>
          <h2>Decisions are only<br />as good as the <em>data.</em></h2>
          <div className="practice-aside">
            <p>Spend drifts, pipelines break silently, and a model that proved its point in a notebook never reaches production. Nothing announces it.</p>
            <a className="text-link" href="#services">See how we work <ArrowRight size={15} /></a>
          </div>
        </div>
        <div className="signal-list">
          {riskSignals.map(([number, title, copy]) => (
            <article className="signal-row" key={number}>
              <span className="signal-number">{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <span className="signal-mark" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
        <div className="practice-footnote"><span>CYRAOPS POINT OF VIEW</span><p>Less infrastructure noise. More room for the work only your team can do.</p></div>
      </div>
    </section>
  );
}

function ServicesSection() {
  const [openService, setOpenService] = useState(SERVICES_CONTENT[0]?.id ?? '');

  return (
    <section className="services section-pad" id="solutions">
      <div className="shell services-layout">
        <div className="services-intro">
          <Eyebrow light>SOLUTIONS</Eyebrow>
          <h2>Four <em>outcomes.</em><br />One team.</h2>
          <p>Every engagement is one of four outcomes. Each is scoped, priced and staffed on its own — and all of them end with your team able to run the result.</p>
          <a className="button button-light" href="#contact">Book a scoping call <ArrowUpRight size={16} /></a>
          <div className="services-note">DATA · AI · PLATFORM · OPERATIONS <span /> YOU KEEP OWNERSHIP</div>
        </div>
        <div className="service-list">
          {SERVICES_CONTENT.map((service, index) => {
            const open = openService === service.id;
            return (
              <Fragment key={service.id}>
                {/* The portfolio has two halves: what we build, and what we run. */}
                <article className={`service-row ${open ? 'service-open' : ''}`}>
                  <button className="service-trigger" onClick={() => setOpenService(open ? '' : service.id)} aria-expanded={open}>
                    <span className="service-number">{service.number}</span>
                    <span className="service-title-wrap">
                      <span className="service-title">{service.title}</span>
                      <span className="service-tagline">{service.tagline}</span>
                      {/* Names stay visible when collapsed, so the index is readable without six clicks. */}
                      <span className="service-chips">{service.deliverables.map(item => item.split(' — ')[0]).join(' · ')}</span>
                    </span>
                    <span className="service-toggle">{open ? '−' : '+'}</span>
                  </button>
                  {/* Always mounted: search engines and screen readers must see the services. */}
                  <div className="service-detail" hidden={!open}>
                    <p>{service.description}</p>
                    <ul>{service.deliverables.map(item => <li key={item}><Check size={13} /><span>{item}</span></li>)}</ul>
                    <a className="service-inquire" href="#contact">Discuss this service <ArrowUpRight size={14} /></a>
                  </div>
                </article>
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Industries as a strip, not a third full section: three axes of navigation is a
 * consultancy-site pattern, but at this size it just makes the page longer. The
 * sectors belong on one line, beside the claim that we only list what we can back.
 */
/**
 * Proof, and the one claim competitors cannot copy: the firm runs its own product.
 * Fractal can show logos; at this size the honest equivalent is the thing we built
 * and still operate.
 */
function ProofSection() {
  return (
    <section className="proof section-pad" id="proof">
      <div className="shell proof-layout">
        <div className="proof-copy">
          <Eyebrow>WHY CYRAOPS</Eyebrow>
          <h2>We run<br />what we <em>sell.</em></h2>
          <p>Cyraops CRM is our own product: an operations platform with an agent runtime, running on the same stack we build for clients. We are not guessing at what production asks of you.</p>
          <a className="text-link" href="#contact">Ask us about the build <ArrowRight size={15} /></a>
        </div>
        <div className="proof-facts">
          <div><span>01</span><p>Our own product in production, not a demo</p></div>
          <div><span>02</span><p>Data, AI and infrastructure under one team</p></div>
          <div><span>03</span><p>You keep ownership of everything we build</p></div>
        </div>
      </div>
    </section>
  );
}

function IndustriesSection() {
  return (
    <section className="industries section-pad" id="industries">
      <div className="shell">
        <div className="practice-heading">
          <Eyebrow>WHERE WE WORK</Eyebrow>
          <h2>Five sectors, <em>one</em> way of working.</h2>
          <div className="practice-aside">
            <p>We only list sectors we have a real story for. If yours is not here, we will tell you honestly whether we are the right team.</p>
          </div>
        </div>
        <div className="industry-strip">
          {INDUSTRIES_CONTENT.map((industry) => (
            <div className="industry-item" key={industry.name}>
              <h3>{industry.name}</h3>
              <p>{industry.line}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HealthCheckSection() {
  return (
    <section className="health-check section-pad" id="health-check">
      <div className="shell">
        <div className="health-heading">
          <div>
            <Eyebrow>THE FIRST ENGAGEMENT</Eyebrow>
            <h2>Start with <em>clarity.</em></h2>
          </div>
          <p>A focused review of your AWS environment: what needs attention, what can wait, and where spend may be leaking. For data and AI work, the same fixed-scope entry point applies — start with one pipeline or one model.</p>
        </div>
        <div className="health-feature">
          <div className="health-copy">
            <span className="micro-label">CLOUD HEALTH CHECK · AWS</span>
            <h3>A clear read on<br />your cloud today.</h3>
            <p>One fixed-scope review. Practical findings, prioritized recommendations, and a short written report. No long-term commitment required.</p>
            <div className="health-price"><strong>$150–$250</strong><span>one-time assessment</span></div>
            <ul className="health-includes">
              {['EC2, EBS & S3 review', 'CloudWatch and monitoring', 'Backup and snapshot checks', 'Idle resource and cost review', 'Prioritized written recommendations'].map(item => <li key={item}><Check size={14} />{item}</li>)}
            </ul>
            <a className="button button-primary" href="#contact">Ask about a health check <ArrowRight size={17} /></a>
          </div>
          <div className="report-preview" aria-label="Illustrative health check sample">
            <div className="report-head">
              <div><span className="report-overline">CYRAOPS / FIELD REPORT</span><h4>Health check <span>·</span> sample</h4></div>
              <span className="report-stamp">ILLUSTRATIVE</span>
            </div>
            <div className="report-meta"><span>ENVIRONMENT REVIEW</span><span>3 SIGNALS SHOWN</span></div>
            <div className="report-finding finding-high"><span className="finding-index">01</span><div><span className="finding-kind">STORAGE · ATTENTION</span><h5>Unattached volumes and aging snapshots</h5><p>Resources left behind after terminated staging instances.</p></div><span className="finding-arrow">↗</span></div>
            <div className="report-finding finding-high"><span className="finding-index">02</span><div><span className="finding-kind">MONITORING · ATTENTION</span><h5>Production database without threshold alarms</h5><p>Key metrics active, with no alert path for threshold events.</p></div><span className="finding-arrow">↗</span></div>
            <div className="report-finding finding-medium"><span className="finding-index">03</span><div><span className="finding-kind">COMPUTE · OPPORTUNITY</span><h5>Staging fleet sized above observed usage</h5><p>Right-sizing candidates to review with your team.</p></div><span className="finding-arrow">↗</span></div>
            <div className="report-foot"><span><i className="status-dot" />PRIORITIES, MADE VISIBLE</span><span>01 / 03</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CostSection() {
  const baseline = costRows.reduce((sum, row) => sum + row.old, 0);
  const reviewed = costRows.reduce((sum, row) => sum + row.next, 0);

  return (
    <section className="cost-section section-pad" id="cost">
      <div className="shell">
        <div className="cost-heading">
          <div><Eyebrow>EFFICIENCY, WITHOUT GUESSWORK</Eyebrow><h2>Make room in<br />the <em>cloud bill.</em></h2></div>
          <p>Cost optimization starts with understanding what is running, who needs it, and what trade-offs a change would bring.</p>
        </div>
        <div className="cost-board">
          <div className="cost-board-head"><span>ILLUSTRATIVE MONTHLY COST MODEL</span><span className="demo-tag">DEMO DATA · NOT A SAVINGS PROMISE</span></div>
          <div className="cost-chart">
            <div className="chart-axis"><span>$1,500</span><span>$1,000</span><span>$500</span><span>$0</span></div>
            {costRows.map(row => <div className="chart-row" key={row.name}>
              <span className="chart-name">{row.name}</span>
              <div className="chart-bars"><div className="bar-track"><span className="bar-before" style={{ width: `${(row.old / 1500) * 100}%` }} /></div><div className="bar-track"><span className="bar-after" style={{ width: `${(row.next / 1500) * 100}%` }} /></div></div>
              <span className="chart-values"><b>${row.old.toLocaleString()}</b><i>${row.next.toLocaleString()}</i></span>
            </div>)}
            <div className="chart-legend"><span><i className="legend-before" />Before review</span><span><i className="legend-after" />Illustrative after</span></div>
          </div>
          <div className="cost-summary">
            <div><span>MODEL BASELINE</span><strong>${baseline.toLocaleString()}<small>/mo</small></strong></div>
            <div className="summary-arrow"><ArrowRight size={18} /></div>
            <div><span>MODEL AFTER REVIEW</span><strong>${reviewed.toLocaleString()}<small>/mo</small></strong></div>
            <div className="summary-difference"><span>ILLUSTRATIVE DIFFERENCE</span><strong>−${(baseline - reviewed).toLocaleString()}<small>/mo</small></strong></div>
          </div>
          <p className="cost-disclaimer">Example only. Actual costs and savings depend on the workload, usage patterns, architecture, and the changes approved by your team.</p>
        </div>
      </div>
    </section>
  );
}

function ManagedCareSection() {
  return (
    <section className="managed section-pad" id="managed-care">
      <div className="shell managed-layout">
        <div className="managed-copy">
          <Eyebrow>ONGOING CLOUD CARE</Eyebrow>
          <h2>Your team builds.<br />We help keep<br />the cloud <em>steady.</em></h2>
          <p>Recurring operational support for teams that need consistent cloud oversight, without adding a full-time cloud engineer.</p>
          <div className="managed-price"><span>STARTING AT</span><strong>$750<small>/ month</small></strong><i>Scope agreed up front</i></div>
          <a className="button button-dark" href="#contact">Talk about ongoing care <ArrowRight size={17} /></a>
        </div>
        <div className="managed-details">
          <div className="managed-details-head"><span>INCLUDED IN CLOUD CARE</span><span>01 — 07</span></div>
          <ul>{careIncludes.map((item, i) => <li key={item}><span>{String(i + 1).padStart(2, '0')}</span>{item}<Check size={14} /></li>)}</ul>
          <div className="scope-notes"><p>Plans are tailored to infrastructure size, environments, support expectations, and required response times.</p><p>24/7 support is not included unless explicitly agreed. Broader operations can scale to $1,000–$2,000+/month depending on scope and service expectations.</p></div>
        </div>
      </div>
    </section>
  );
}

function ApproachSection() {
  return (
    <section className="approach section-pad" id="approach">
      <div className="shell">
        <div className="approach-heading"><div><Eyebrow>HOW WE WORK</Eyebrow><h2>Clear steps.<br /><em>Careful changes.</em></h2></div><p>We work in a visible sequence: understand the environment, agree priorities, and make only the changes your team approves.</p></div>
        <div className="approach-track">
          {HOW_WE_WORK_CONTENT.map((step, i) => <article className="approach-step" key={step.step}>
            <div className="step-top"><span>{step.step}</span><i className={i === HOW_WE_WORK_CONTENT.length - 1 ? 'last-step-dot' : ''} /></div>
            <h3>{step.title}</h3><p>{step.description}</p>
            <span className="step-output">{step.systemState}</span>
          </article>)}
        </div>
        <div className="approach-foot"><span>YOUR TEAM KEEPS OWNERSHIP</span><p>Scope agreed. Changes approved. Work documented.</p></div>
      </div>
    </section>
  );
}

function PrinciplesSection() {
  return (
    <section className="principles section-pad" id="why-us">
      <div className="shell principles-layout">
        <div className="principles-lead"><Eyebrow light>WHY CYRAOPS</Eyebrow><h2>Practical delivery.<br /><em>Zero theatre.</em></h2><p>A senior cloud, data and AI team for companies that need the work built and then actually run — without hiring a department to do it.</p></div>
        <div className="principles-list">{principles.map(point => <article className="principle-row" key={point.number}><span>{point.number}</span><div><h3>{point.title}</h3><p>{point.copy}</p></div><ArrowUpRight size={16} /></article>)}</div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [active, setActive] = useState<number | null>(0);
  return (
    <section className="faq section-pad" id="faq">
      <div className="shell faq-layout">
        <div className="faq-heading"><Eyebrow>GOOD TO KNOW</Eyebrow><h2>Clear answers,<br /><em>before we start.</em></h2><p>Questions about access, scope, and what support actually includes.</p><a className="text-link" href="#contact">Ask us directly <ArrowUpRight size={15} /></a></div>
        <div className="faq-list">{FAQ_CONTENT.map((item, i) => <article className={`faq-item ${active === i ? 'faq-active' : ''}`} key={item.question}>
          <button onClick={() => setActive(active === i ? null : i)} aria-expanded={active === i}><span>{item.question}</span><span className="faq-plus">{active === i ? '−' : '+'}</span></button>
          {active === i && <p>{item.answer}</p>}
        </article>)}</div>
      </div>
    </section>
  );
}

function ContactSection() {
  const [fields, setFields] = useState<ContactFields>(blankContact);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setField = (key: keyof ContactFields, value: string) => setFields(current => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/public/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!response.ok) throw new Error('Request failed');
      setStatus({ type: 'success', message: 'Thanks — we’ve received your inquiry and will review it shortly.' });
      setFields(blankContact);
    } catch {
      setStatus({ type: 'error', message: 'We couldn’t send that just now. Please try again in a moment.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="contact section-pad" id="contact">
      <div className="shell contact-layout">
        <div className="contact-copy"><Eyebrow light>START A CONVERSATION</Eyebrow><h2>Let’s make your cloud feel <em>lighter.</em></h2><p>Tell us what you’re running and where you want more clarity. We’ll start with the smallest useful step.</p>
          <div className="contact-security"><span className="security-mark"><Check size={15} /></span><div><b>A note on access</b><p>Never send cloud passwords, root credentials, database dumps, or private keys through this form. We’ll agree a scoped access approach if needed.</p></div></div>
          <div className="contact-pricing"><span>FIRST STEP</span><b>Health check <i>$150–$250</i></b><span>ONGOING CARE</span><b>Cloud care <i>from $750/mo</i></b></div>
        </div>
        <form className="contact-form" onSubmit={handleSubmit}>
          <div className="form-top"><span>PROJECT INQUIRY</span><span>01 / 01</span></div>
          <label aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            Leave this field empty
            <input name="website" tabIndex={-1} autoComplete="off" value={fields.website} onChange={e => setField('website', e.target.value)} />
          </label>
          <div className="form-grid">
            <label className="form-field"><span>Your name <b>*</b></span><input required name="name" autoComplete="name" placeholder="Alex Morgan" value={fields.name} onChange={e => setField('name', e.target.value)} /></label>
            <label className="form-field"><span>Work email <b>*</b></span><input required type="email" name="email" autoComplete="email" placeholder="alex@company.com" value={fields.email} onChange={e => setField('email', e.target.value)} /></label>
            <label className="form-field"><span>Company <i>OPTIONAL</i></span><input name="company" autoComplete="organization" placeholder="Company name" value={fields.company} onChange={e => setField('company', e.target.value)} /></label>
            <label className="form-field"><span>Approx. AWS spend <i>OPTIONAL</i></span><select name="spend" value={fields.spend} onChange={e => setField('spend', e.target.value)}><option value="">Choose a range</option><option>Under $1,000 / month</option><option>$1,000–$5,000 / month</option><option>$5,000–$20,000 / month</option><option>$20,000+ / month</option></select></label>
            <label className="form-field form-wide"><span>What would you like help with? <b>*</b></span><textarea required name="helpTopic" rows={4} placeholder="A little about your environment and what you’d like to improve…" value={fields.helpTopic} onChange={e => setField('helpTopic', e.target.value)} /></label>
            <label className="form-field form-wide"><span>Anything else about your setup? <i>OPTIONAL</i></span><input name="environment" placeholder="Services, team size, current challenges…" value={fields.environment} onChange={e => setField('environment', e.target.value)} /></label>
          </div>
          <div className="form-submit-row"><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send inquiry'} <ArrowRight size={16} /></button><span>Share only the context that helps us understand your setup.</span></div>
          {status && <p className={`form-status ${status.type}`} role="status">{status.message}</p>}
        </form>
      </div>
    </section>
  );
}

function Footer() {
  return <footer className="site-footer"><div className="shell footer-main"><BrandMark /><p>Cloud, data and AI delivery<br />for teams building what’s next.</p><div className="footer-links"><a href="#services">Services</a><a href="#health-check">Health check</a><a href="#approach">Our approach</a><a href="#contact">Contact</a></div><a className="footer-top" href="#top">BACK TO TOP <ArrowUpRight size={14} /></a></div><div className="shell footer-bottom"><span>© {new Date().getFullYear()} CyraOps</span><span>CLOUD · DATA · AI · OPERATED</span><span>BUILT FOR A QUIETER CLOUD</span></div></footer>;
}

export const App: React.FC = () => (
  <>
    <Suspense fallback={<div className="ambient-layer ambient-fallback" aria-hidden="true" />}>
      <AmbientField3D />
    </Suspense>
    <Header />
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <main id="main-content" tabIndex={-1}>
      <Hero />
      <PracticeSection />
      <ServicesSection />
      <IndustriesSection />
      <ProofSection />
      <HealthCheckSection />
      <CostSection />
      <ManagedCareSection />
      <ApproachSection />
      <PrinciplesSection />
      <FAQSection />
      <ContactSection />
    </main>
    </>
    <Footer />
  </>
);

export default App;
