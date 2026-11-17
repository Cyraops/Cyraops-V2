import catalog from "../data/catalog.json";
import { slug } from "../data/nav";

/**
 * Per-route metadata.
 *
 * One shared <title> for eight routes was a real defect: a search result can
 * only say what the page says. Every route now gets its own title, description
 * and canonical, plus structured data where it is honestly available.
 *
 * Canonical host is www.cyraops.com — the apex redirects here (see middleware).
 */

export const SITE = "https://www.cyraops.com";

const BRAND = "CyraOps";

/** Page-level metadata, derived from the same catalogue the pages render. */
export function metaFor(path: string): { title: string; description: string; canonical: string } {
  const canonical = `${SITE}${path === "/" ? "/" : path}`;
  const home = {
    title: `${BRAND} — data, AI and platform engineering`,
    description:
      "CyraOps builds and runs the data platforms, AI systems and application layers enterprises depend on. Six ways in: solutions, products, AI foundation, enterprise AI, functions and industries.",
    canonical,
  };

  if (path === "/") return home;

  if (path === "/catalogue") {
    return {
      title: `Catalogue — every ${BRAND} offering`,
      description:
        "The full CyraOps catalogue: 61 offerings across solutions, products, AI foundation, enterprise AI, business functions and industries, each with who it is for and what you get.",
      canonical,
    };
  }

  if (path === "/contact") {
    return {
      title: `Contact ${BRAND}`,
      description:
        "Tell us what you are trying to get working. A one-page scope and an honest answer on whether we are the right team, usually within two working days.",
      canonical,
    };
  }

  const about: Record<string, { title: string; description: string }> = {
    "/about": {
      title: `About ${BRAND} — the practice`,
      description:
        "A senior team that builds data and AI systems and then runs them. How we work, how engagements are shaped, and what we deliberately do not do.",
    },
    "/about/how": {
      title: `How we work — ${BRAND}`,
      description:
        "Scope, prove, build, run: the four steps from first call to a system in production, and what you get at the end of each.",
    },
    "/about/engagement": {
      title: `Ways of engaging — ${BRAND}`,
      description:
        "Fixed-scope projects, monthly retainers, embedded work with your team, and licensed products — how each is priced and when each makes sense.",
    },
    "/about/faq": {
      title: `Questions we are asked — ${BRAND}`,
      description:
        "Platforms we work on, how a project starts, data handling, and the list of things CyraOps does not do — with the reason for each.",
    },
  };
  if (about[path]) return { ...about[path], canonical };

  const [, axisId, itemSlug] = path.split("/");
  const axis = (catalog.axes as Array<{ axis: string; label: string; items: Array<{ name: string; outcome: string; who_for?: string }> }>).find(
    (a) => a.axis === axisId
  );

  if (axis && !itemSlug) {
    return {
      title: `${axis.label} — ${BRAND}`,
      description: `${axis.items.length} ${axis.label.toLowerCase()} offerings: ${axis.items
        .slice(0, 4)
        .map((i) => i.name)
        .join(", ")} and more. What each is, who it is for, and what you get.`,
      canonical,
    };
  }

  if (axis && itemSlug) {
    const item = axis.items.find((i) => slug(i.name) === itemSlug);
    if (item) {
      return {
        title: `${item.name} — ${axis.label} | ${BRAND}`,
        description: `${item.outcome} ${item.who_for ? `For ${item.who_for}.` : ""}`.slice(0, 300),
        canonical,
      };
    }
  }

  return {
    title: `Not found — ${BRAND}`,
    description: "That page does not exist. Start from the catalogue.",
    canonical,
  };
}

/**
 * Structured data. Only what is true and verifiable: the organisation, its
 * website, and the catalogue as an ItemList of services. No ratings, no
 * invented reviews.
 */
export function structuredData(path: string) {
  const org = {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: BRAND,
    url: SITE,
    email: "hello@cyraops.com",
    description:
      "CyraOps builds and runs data platforms, AI systems and application layers for enterprises.",
    areaServed: "Worldwide",
  };

  const graph: unknown[] = [org, { "@type": "WebSite", "@id": `${SITE}/#website`, url: SITE, name: BRAND, publisher: { "@id": `${SITE}/#organization` } }];

  if (path === "/catalogue" || path === "/") {
    graph.push({
      "@type": "ItemList",
      name: "CyraOps services",
      itemListElement: (catalog.axes as Array<{ axis: string; label: string; items: Array<{ name: string; outcome: string }> }>).flatMap((axis, i) =>
        axis.items.slice(0, 12).map((item, j) => ({
          "@type": "ListItem",
          position: i * 12 + j + 1,
          name: item.name,
          description: item.outcome,
          url: `${SITE}/${axis.axis}/${slug(item.name)}`,
        }))
      ),
    });
  }

  const [, axisId, itemSlug] = path.split("/");
  if (axisId && itemSlug) {
    const axis = (catalog.axes as Array<{ axis: string; label: string; items: Array<{ name: string; outcome: string; what: string }> }>).find((a) => a.axis === axisId);
    const item = axis?.items.find((i) => slug(i.name) === itemSlug);
    if (axis && item) {
      graph.push({
        "@type": "Service",
        name: item.name,
        description: item.outcome,
        serviceType: axis.label,
        provider: { "@id": `${SITE}/#organization` },
        url: `${SITE}${path}`,
        areaServed: "Worldwide",
      });
    }
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Apply the metadata to the live document. Runs on every route change so the
 * tab title, the canonical and the structured data always describe the page the
 * reader is actually on — including SPA navigation, which a crawler never sees.
 */
export function applyMeta(path: string) {
  if (typeof document === "undefined") return;
  const meta = metaFor(path);
  document.title = meta.title;

  const setMeta = (attr: "name" | "property", key: string, value: string) => {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", value);
  };

  setMeta("name", "description", meta.description);
  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("property", "og:type", "website");
  setMeta("property", "og:url", meta.canonical);
  setMeta("property", "og:site_name", "CyraOps");
  setMeta("name", "twitter:card", "summary");
  setMeta("name", "twitter:title", meta.title);
  setMeta("name", "twitter:description", meta.description);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = meta.canonical;

  let ld = document.head.querySelector<HTMLScriptElement>('script[data-schema="cyraops"]');
  if (!ld) {
    ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.dataset.schema = "cyraops";
    document.head.appendChild(ld);
  }
  ld.textContent = JSON.stringify(structuredData(path));
}
