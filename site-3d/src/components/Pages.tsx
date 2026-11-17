import { useState } from "react";
import catalog from "../data/catalog.json";
import exclusions from "../data/exclusions.json";
import { ALL_OFFERINGS, slug } from "../data/nav";
import { navigate } from "../lib/router";

type Item = { name: string; outcome: string; what: string; who_for?: string; capabilities: string[]; details?: string[]; tier?: string };
type Axis = { axis: string; label: string; intro: { eyebrow: string; headline: string; sub: string }; items: Item[] };

const axes = (catalog as any).axes as Axis[];

const emphasis = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*(.+?)\*/g, "<em>$1</em>");

function Crumbs({ trail }: { trail: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Home</a>
      {trail.map((crumb) => (
        <span key={crumb.label}>
          <i aria-hidden="true">/</i>
          {crumb.href ? (
            <a href={crumb.href} onClick={(e) => { e.preventDefault(); navigate(crumb.href!); }}>{crumb.label}</a>
          ) : (
            <b aria-current="page">{crumb.label}</b>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------- axis index -- */

export function AxisPage({ axisId }: { axisId: string }) {
  const axis = axes.find((a) => a.axis === axisId);
  if (!axis) return <NotFound />;

  return (
    <div className="page">
      <div className="shell">
        <Crumbs trail={[{ label: axis.label }]} />
        <header className="page-head">
          <span className="eyebrow">{axis.intro.eyebrow}</span>
          <h1 className="display page-title" dangerouslySetInnerHTML={{ __html: emphasis(axis.intro.headline) }} />
          <p className="lead page-sub">{axis.intro.sub}</p>
          <p className="small">{axis.items.length} offerings</p>
        </header>

        <div className="card-grid">
          {axis.items.map((item, index) => (
            <a
              className="card"
              key={item.name}
              href={`/${axis.axis}/${slug(item.name)}`}
              onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}/${slug(item.name)}`); }}
            >
              <span className="card-index">{String(index + 1).padStart(2, "0")}</span>
              <h2 className="card-title">{item.name}</h2>
              <p className="card-outcome">{item.outcome}</p>
              {item.who_for && <p className="card-who">For {item.who_for}</p>}
              <span className="card-caps">
                {item.capabilities.slice(0, 3).map((cap) => (
                  <span className="chip" key={cap}>{cap}</span>
                ))}
              </span>
              {item.tier === "selective" && <span className="card-flag">Selective</span>}
              <span className="card-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- offering detail -- */

export function OfferingPage({ axisId, itemSlug }: { axisId: string; itemSlug: string }) {
  const axis = axes.find((a) => a.axis === axisId);
  const item = axis?.items.find((candidate) => slug(candidate.name) === itemSlug);
  if (!axis || !item) return <NotFound />;

  const related = axis.items.filter((candidate) => candidate.name !== item.name).slice(0, 3);

  return (
    <div className="page">
      <div className="shell">
        <Crumbs trail={[{ label: axis.label, href: `/${axis.axis}` }, { label: item.name }]} />

        <header className="page-head detail-head">
          <span className="eyebrow">{axis.label}</span>
          <h1 className="display page-title">{item.name}</h1>
          <p className="lead page-sub">{item.outcome}</p>
          <div className="detail-actions">
            <a className="btn btn-primary" href="/contact" onClick={(e) => { e.preventDefault(); navigate("/contact"); }}>
              Discuss this <span className="arrow">↗</span>
            </a>
            <a className="btn btn-ghost" href={`/${axis.axis}`} onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}`); }}>
              All {axis.label}
            </a>
          </div>
        </header>

        <div className="detail-grid">
          <div>
            <h2 className="detail-h">What it is</h2>
            <p className="body">{item.what}</p>

            {item.who_for && (
              <>
                <h2 className="detail-h">Who it's for</h2>
                <p className="body">{item.who_for}</p>
              </>
            )}

            <h2 className="detail-h">What you get</h2>
            <ul className="detail-list">
              {(item.details ?? item.capabilities).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {item.tier === "selective" && (
              <div className="notice">
                <b>Selective offering.</b> We take this on in a specific shape — usually one workflow, one entity or
                one site — and we say so before scoping rather than after. {axis.label} list it because we can staff
                it honestly; if the shape does not fit, we will tell you.
              </div>
            )}
          </div>

          <aside className="detail-aside">
            <div className="aside-block">
              <h3>How this runs</h3>
              <p className="small">
                {axis.axis === "products"
                  ? "Take it as a licence, or installed in your own cloud. Either way you own the deployment."
                  : "Scope in a week. A working slice on your data before the full build. You own everything we produce."}
              </p>
            </div>
            <div className="aside-block">
              <h3>Starts with</h3>
              <p className="small">A 45 minute call and a one page scope, free. No deck, no discovery invoice.</p>
            </div>
            <div className="aside-block">
              <h3>Related</h3>
              <div className="aside-links">
                {related.map((rel) => (
                  <a key={rel.name} href={`/${axis.axis}/${slug(rel.name)}`} onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}/${slug(rel.name)}`); }}>
                    {rel.name}
                  </a>
                ))}
                <a className="mega-all" href={`/${axis.axis}`} onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}`); }}>
                  All {axis.label} →
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- catalogue -- */

export function CataloguePage() {
  const [filter, setFilter] = useState("");
  const filterItems = (items: Item[], needle: string) => {
    const query = needle.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query) || item.outcome.toLowerCase().includes(query));
  };
  return (
    <div className="page">
      <div className="shell">
        <Crumbs trail={[{ label: "Catalogue" }]} />
        <header className="page-head">
          <span className="eyebrow">Everything we sell</span>
          <h1 className="display page-title">The whole <em>catalogue.</em></h1>
          <p className="lead page-sub">
            {ALL_OFFERINGS.length} offerings across {axes.length} axes. Selective items are ones we take in a specific
            shape and say so up front.
          </p>
        </header>

        <input
          className="cat-filter"
          type="search"
          placeholder="Filter 39 offerings by name or outcome…"
          aria-label="Filter the catalogue"
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="legend"><b>Selective</b> = we take it in a specific shape and say so up front.</div>

        <nav className="subnav" aria-label="Jump to axis">
          {axes.map((axis) => (
            <a key={axis.axis} href={`/${axis.axis}`} onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}`); }}>{axis.label}</a>
          ))}
        </nav>

        {axes.map((axis) => {
          const items = filterItems(axis.items, filter);
          return (
          <section className="cat-section" key={axis.axis}>
            <div className="cat-head">
              <h2 className="h3">{axis.label}</h2>
              <a className="link-underline" href={`/${axis.axis}`} onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}`); }}>
                Open {axis.label}
              </a>
            </div>
            <div className="cat-list">
              {items.map((item) => (
                <a
                  key={item.name}
                  href={`/${axis.axis}/${slug(item.name)}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/${axis.axis}/${slug(item.name)}`); }}
                >
                  <span>
                    {item.name}
                    {item.tier === "selective" && <span className="cat-flag">Selective</span>}
                  </span>
                  <span className="cat-outcome">{item.outcome}{item.who_for ? ` — for ${item.who_for}` : ""}</span>
                </a>
              ))}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ static pages -- */

export function AboutPage({ section }: { section?: string }) {
  const title = section === "how" ? "How we work" : section === "engagement" ? "Ways of engaging" : section === "faq" ? "Frequently asked" : "Why CyraOps";

  return (
    <div className="page">
      <div className="shell">
        <Crumbs trail={[{ label: "About", href: "/about" }, ...(section ? [{ label: title }] : [])]} />
        <nav className="subnav" aria-label="About sections">
          {[
            ["", "Why CyraOps"],
            ["how", "How we work"],
            ["engagement", "Ways of engaging"],
            ["faq", "Frequently asked"],
          ].map(([key, label]) =>
            key === (section ?? "") ? (
              <span className="subnav-current" aria-current="page" key={key}>{label}</span>
            ) : (
              <a key={key} href={`/about${key ? `/${key}` : ""}`} onClick={(e) => { e.preventDefault(); navigate(`/about${key ? `/${key}` : ""}`); }}>{label}</a>
            )
          )}
        </nav>
        {section ? (
          <header className="page-head" style={{ marginTop: 8 }}>
            <span className="eyebrow">About</span>
            <h1 className="display page-title">{title}</h1>
          </header>
        ) : (
          <header className="page-head" style={{ marginBottom: 8 }}>
            <span className="eyebrow">About CyraOps</span>
          </header>
        )}

        {section === "how" && (
          <div className="prose">
            {[
              ["Scope", "One week, one problem. We agree the decision the work has to change, the data that decides it, and what done looks like."],
              ["Prove", "A thin vertical slice on your real data — a pipeline, a model, a screen — rather than a slide deck."],
              ["Build", "Production engineering: tests, IaC, CI, evaluation harnesses. Shipped in usable increments."],
              ["Run", "We stay accountable after go-live: monitoring, cost, retraining, incident response."],
            ].map(([heading, body], i) => (
              <section key={heading}>
                <span className="prose-num">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="h3">{heading}</h2>
                <p className="body">{body}</p>
              </section>
            ))}
          </div>
        )}

        {section === "engagement" && (
          <div className="prose">
            {[
              ["Fixed-scope project", "A defined outcome, a named lead, a price. Most Solutions entries run this way."],
              ["Monthly retainer", "Managed operations: monitoring, cost, maintenance, incident cover. Scope and response windows in writing."],
              ["Embedded with your team", "A senior engineer inside your sprints, for as long as it is useful. You keep the IP."],
            ].map(([heading, body]) => (
              <section key={heading}>
                <h2 className="h3">{heading}</h2>
                <p className="body">{body}</p>
              </section>
            ))}
          </div>
        )}

        {section === "faq" && (
          <div className="prose">
            {[
              ["Which platforms do you work on?", "AWS, Microsoft Azure and Google Cloud. Snowflake, Databricks and Amazon Redshift for warehouse and lakehouse. Terraform, Kubernetes and standard CI."],
              ["Do we have to give you production access?", "No. We work read-only against what the scope needs, and use scoped roles rather than shared credentials."],
              ["How do you price?", "Fixed price for scoped projects, monthly for operations. You get the number before we start, and it does not move because we estimated badly."],
              ["Do you promise savings percentages?", "No. We show what we found and what it is worth, and you decide. Any vendor promising a percentage before looking is guessing."],
              ["What happens after go-live?", "Either your team runs it with our documentation, or we do under a retainer. Both are fine; we will not pretend handover is always best."],
              ["Why a small team rather than a large consultancy?", "Because the people who scope the work are the people who build and run it. Nothing is re-sold, subcontracted or handed to a graduate delivery pod after you sign."],
              ["What do you not do?", "The list is public because saying so is what makes the rest of the page trustworthy:"],
            ].map(([question, answer]) => (
              <section key={question}>
                <h2 className="h3">{question}</h2>
                <p className="body">{answer}</p>
              </section>
            ))}
          </div>
        )}

        {!section && (
          <div className="split about-split">
            <div>
              <h1 className="display" style={{ fontSize: "clamp(38px, 5.6vw, 78px)" }}>
                We run<br />what we <em>sell.</em>
              </h1>
              <p className="lead" style={{ marginTop: 20 }}>
                Most consultancies stop at the deck, or at the code review. We started on the other side of that line:
                we built an operations platform of our own, put it into production, and have kept it running since.
              </p>
              <p className="body" style={{ marginTop: 16 }}>
                That product set the bar the rest of our work has to clear — approvals before an agent acts, a written
                record of what ran, a way to replay it, and a cost ceiling that holds. Those are not features we talk
                about in a proposal; they are things our own software had to survive.
              </p>
              <p className="body" style={{ marginTop: 16 }}>
                It also narrowed the catalogue. We list what we can staff with people we can name. Where a problem needs
                a firm with three hundred engineers, we introduce one instead of pretending.
              </p>
            </div>
            <div className="proof-facts proof-light">
              {[
                "Our own product in production, not a demo",
                "Data, AI and infrastructure under one team",
                "You keep ownership of everything we build",
                "Same people scope it, build it and run it",
              ].map((fact, i) => (
                <div className="proof-fact" key={fact}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <p style={{ margin: 0 }}>{fact}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactPage() {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/public/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          company: data.company ?? "",
          helpTopic: data.helpTopic,
          environment: "",
          spend: "",
          website: data.website ?? "",
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError((body as any).error || "Could not send. Email hello@cyraops.com instead.");
        return;
      }
      setSent(true);
      form.reset();
    } catch {
      setError("Could not send. Email hello@cyraops.com instead.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <div className="shell">
        <Crumbs trail={[{ label: "Contact" }]} />
        <div className="contact-grid">
          <div>
            <span className="eyebrow">Contact</span>
            <h1 className="display page-title">Bring us the <em>hard</em> part.</h1>
            <p className="lead" style={{ marginTop: 20 }}>
              Tell us the decision or the system you are stuck on — a pipeline that keeps breaking, a model that never
              shipped, a bill nobody can explain. You will get an honest read on whether we are the right team and
              what we would do in the first two weeks. If we are not, we will say so and point you at who is.
            </p>
            <div className="contact-meta">
              <div><b>Email</b><span>hello@cyraops.com</span></div>
              <div><b>Response</b><span>Within one working day</span></div>
              <div><b>Where</b><span>Remote, IST overlap with EU and US East</span></div>
            </div>
          </div>

          <form className="contact-form" onSubmit={submit}>
            <label><span>Name</span><input name="name" required placeholder="Your name" /></label>
            <label><span>Work email</span><input name="email" required type="email" placeholder="you@company.com" /></label>
            <label><span>Company</span><input name="company" placeholder="Company" /></label>
            <label><span>What is the decision you are stuck on?</span><textarea name="helpTopic" rows={4} required minLength={10} placeholder="A sentence is enough." /></label>
            {/* Honeypot: humans never see this; the intake endpoint drops bots that fill it. */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="honeypot" />
            <button className="btn btn-primary" type="submit" disabled={sending}>{sending ? "Sending…" : "Send"} <span className="arrow">↗</span></button>
            {sent && <p className="small" style={{ color: "#3d6b1f" }}>Sent — we will reply within one working day.</p>}
            {error && <p className="small" style={{ color: "#a33" }}>{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <span className="eyebrow">404</span>
          <h1 className="display page-title">Nothing <em>here.</em></h1>
          <p className="lead page-sub">That page does not exist. The catalogue is the best place to start.</p>
          <div className="detail-actions">
            <a className="btn btn-primary" href="/catalogue" onClick={(e) => { e.preventDefault(); navigate("/catalogue"); }}>
              Full catalogue
            </a>
          </div>
        </header>
      </div>
    </div>
  );
}
