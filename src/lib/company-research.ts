import { validateDestinationUrl } from "@/lib/ai/browser/browser-runtime";

/**
 * Deterministic company-site research.
 *
 * A language model asked "what does this company do, and what do they run on?"
 * invents plausible answers, and there is no way to tell an invented one from a
 * real one afterwards. This module reads the company's own site and reports only
 * what it actually found, with the exact quote it came from. Everything it could
 * not determine is reported as unchecked rather than guessed — which is what
 * `LEAD_SCORE_V1` needs in order to refuse a confident band.
 *
 * It is a *reader*: no writes, no browser, no JavaScript execution. The HTML is
 * fetched directly and parsed with deterministic rules, so the same site always
 * produces the same findings.
 */

const MAX_BYTES = 512_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

/** Keyword → meaning. Ordered longest-first where substrings overlap. */
const CLOUD_HINTS: Array<{ provider: "aws" | "azure" | "gcp"; patterns: RegExp[] }> = [
  { provider: "aws", patterns: [/\baws\b/i, /amazon web services/i, /amazonaws\.com/i, /\bec2\b/i, /\bs3 bucket/i] },
  { provider: "azure", patterns: [/\bazure\b/i, /microsoft cloud/i, /azurewebsites\.net/i, /\bazure ad\b/i, /entra id/i] },
  { provider: "gcp", patterns: [/\bgcp\b/i, /google cloud/i, /bigquery/i, /\bgsuite\b/i, /firebase/i] },
];

/** Industry vocabulary. A site that talks about freight is a freight company. */
const INDUSTRY_HINTS: Array<{ industry: string; patterns: RegExp[] }> = [
  { industry: "logistics", patterns: [/logistics/i, /freight/i, /warehous/i, /supply chain/i, /fleet/i, /shipping/i] },
  { industry: "fintech", patterns: [/fintech/i, /payments?/i, /lending/i, /banking/i, /underwriting/i, /\bkyc\b/i] },
  { industry: "healthcare", patterns: [/healthcare/i, /clinical/i, /patient/i, /\bhipaa\b/i, /medical/i, /pharma/i] },
  { industry: "ecommerce", patterns: [/e-?commerce/i, /checkout/i, /marketplace/i, /retail/i, /\bshopify\b/i] },
  { industry: "saas", patterns: [/saas/i, /platform as a service/i, /subscription software/i, /\bapi-first\b/i] },
  { industry: "manufacturing", patterns: [/manufactur/i, /factory/i, /production line/i, /\bcnc\b/i, /plant floor/i] },
  { industry: "realestate", patterns: [/real estate/i, /property management/i, /listing/i, /tenant/i] },
  { industry: "education", patterns: [/edtech/i, /university/i, /student/i, /learning platform/i, /curriculum/i] },
];

const MIGRATION_HINTS: Array<{ pain: "migration" | "cost" | "compliance" | "outage"; patterns: RegExp[] }> = [
  { pain: "migration", patterns: [/migrat(e|ing|ion)/i, /lift and shift/i, /re-?platform/i, /moderni[sz]ation/i] },
  { pain: "cost", patterns: [/cloud (spend|cost|bill)/i, /reduce costs?/i, /cost optimi[sz]ation/i, /overprovision/i] },
  { pain: "compliance", patterns: [/\bsoc ?2\b/i, /\biso ?27001\b/i, /\bgdpr\b/i, /compliance/i, /\bpci\b/i] },
  { pain: "outage", patterns: [/downtime/i, /outage/i, /disaster recovery/i, /high availability/i, /uptime/i] },
];

export interface ResearchFinding<T> {
  value: T;
  /** The literal text that justified the finding. */
  quote: string;
  sourceUrl: string;
}

export interface CompanySiteResearch {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  ok: boolean;
  error?: string;
  title: string | null;
  description: string | null;
  headings: string[];
  /** Everything below is `null` when the page did not say it. */
  cloud: ResearchFinding<"aws" | "azure" | "gcp"> | null;
  industry: ResearchFinding<string> | null;
  pains: Array<ResearchFinding<"migration" | "cost" | "compliance" | "outage">>;
  hasCareersPage: boolean;
  careersUrl: string | null;
  hasPricingPage: boolean;
  pricingUrl: string | null;
  /** Pages worth reading next, so an agent does not have to guess URLs. */
  links: string[];
  /** True when the response was cut at the size cap, so quotes may be partial. */
  truncated: boolean;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1] ? stripTags(match[1]).slice(0, 300) || null : null;
}

/** A quote around a keyword match, so the finding can be checked by eye. */
function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return text.slice(start, end).trim().slice(0, 240);
}

function findKeyword<T>(
  text: string,
  options: Array<{ value: T; patterns: RegExp[] }>,
  sourceUrl: string
): ResearchFinding<T> | null {
  for (const option of options) {
    for (const pattern of option.patterns) {
      const match = pattern.exec(text);
      if (match) {
        return {
          value: option.value,
          quote: quoteAround(text, match.index, match[0].length),
          sourceUrl,
        };
      }
    }
  }
  return null;
}

/** Reads at most `MAX_BYTES` of the body, then stops the download. */
async function readCapped(response: Response): Promise<{ html: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { html: "", truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  let bytes = 0;
  let truncated = false;
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
      }
    }
    if (bytes >= MAX_BYTES) truncated = true;
  } finally {
    // Releasing the lock cancels the rest of the body instead of buffering it.
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  return { html: html + decoder.decode(), truncated };
}

/**
 * Fetches a site, following redirects manually so every hop is re-validated.
 * A redirect is the classic way to talk an allowlisted URL into fetching
 * 169.254.169.254, so each hop goes through the same SSRF check as the first.
 */
async function fetchValidated(startUrl: string): Promise<{
  response: Response | null;
  finalUrl: string | null;
  error?: string;
}> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await validateDestinationUrl(current);
    if (!check.valid || !check.normalizedUrl) {
      return { response: null, finalUrl: null, error: check.error ?? "Destination is not allowed" };
    }
    const response = await fetch(check.normalizedUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        // Identify honestly; some sites 403 an empty or browser-like agent.
        "user-agent": "CyraopsResearch/1.0 (+https://www.cyraops.com)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { response, finalUrl: check.normalizedUrl };
      }
      current = new URL(location, check.normalizedUrl).toString();
      continue;
    }
    return { response, finalUrl: check.normalizedUrl };
  }
  return { response: null, finalUrl: null, error: `More than ${MAX_REDIRECTS} redirects` };
}

export async function researchCompanySite(rawUrl: string): Promise<CompanySiteResearch> {
  const requestedUrl = rawUrl.trim();
  const empty: CompanySiteResearch = {
    requestedUrl,
    finalUrl: null,
    status: null,
    ok: false,
    title: null,
    description: null,
    headings: [],
    cloud: null,
    industry: null,
    pains: [],
    hasCareersPage: false,
    careersUrl: null,
    hasPricingPage: false,
    pricingUrl: null,
    links: [],
    truncated: false,
  };

  // Accept a bare domain: "acme.com" is what a person types into a spreadsheet.
  let normalised = requestedUrl;
  if (normalised && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalised)) {
    normalised = `https://${normalised}`;
  }
  if (!normalised) return { ...empty, error: "A company domain or URL is required" };

  let response: Response | null;
  let finalUrl: string | null;
  try {
    const result = await fetchValidated(normalised);
    if (!result.response) return { ...empty, error: result.error };
    response = result.response;
    finalUrl = result.finalUrl;
  } catch (error: any) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "The site did not respond in time"
      : error?.message || "Could not reach the site";
    return { ...empty, error: message };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && contentType && !contentType.includes("text/")) {
    return {
      ...empty,
      finalUrl,
      status: response.status,
      error: `Not an HTML page (${contentType.split(";")[0]})`,
    };
  }

  let html = "";
  let truncated = false;
  try {
    const capped = await readCapped(response);
    html = capped.html;
    truncated = capped.truncated;
  } catch (error: any) {
    return {
      ...empty,
      finalUrl,
      status: response.status,
      error: error?.message || "Could not read the page",
    };
  }

  const sourceUrl = finalUrl ?? normalised;
  const text = stripTags(html);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ||
    firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);

  const headings: string[] = [];
  const headingPattern = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingPattern.exec(html)) && headings.length < 12) {
    const heading = stripTags(headingMatch[1]).slice(0, 160);
    if (heading) headings.push(heading);
  }

  // Links, so the next page an agent reads is a discovered URL rather than a guess.
  const links: string[] = [];
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  let careersUrl: string | null = null;
  let pricingUrl: string | null = null;
  while ((linkMatch = linkPattern.exec(html)) && links.length < 60) {
    const href = linkMatch[1];
    const label = stripTags(linkMatch[2]).toLowerCase();
    let absolute: string;
    try {
      absolute = new URL(href, sourceUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;
    links.push(absolute);
    if (!careersUrl && (/\/(careers|jobs|join-us|hiring)\b/i.test(absolute) || /careers|jobs|we'?re hiring/.test(label))) {
      careersUrl = absolute;
    }
    if (!pricingUrl && (/\/(pricing|plans)\b/i.test(absolute) || /pricing|plans/.test(label))) {
      pricingUrl = absolute;
    }
  }

  const searchable = `${title ?? ""} ${description ?? ""} ${headings.join(" ")} ${text}`;
  const cloud = findKeyword(searchable, CLOUD_HINTS.map((hint) => ({ value: hint.provider, patterns: hint.patterns })), sourceUrl);

  // Industry is a finding, not a decision: matching it against *our* ICP is a
  // business judgement, so `industryMatch` stays unchecked in the lead signals.
  const industry = findKeyword(
    text,
    INDUSTRY_HINTS.map((hint) => ({ value: hint.industry, patterns: hint.patterns })),
    sourceUrl
  );

  const pains: Array<ResearchFinding<"migration" | "cost" | "compliance" | "outage">> = [];
  for (const hint of MIGRATION_HINTS) {
    const found = findKeyword<"migration" | "cost" | "compliance" | "outage">(
      text,
      [{ value: hint.pain, patterns: hint.patterns }],
      sourceUrl
    );
    if (found) pains.push(found);
  }

  return {
    requestedUrl,
    finalUrl: sourceUrl,
    status: response.status,
    ok: response.ok,
    title,
    description,
    headings,
    cloud,
    industry,
    pains,
    hasCareersPage: Boolean(careersUrl) || /\/careers|\/jobs/i.test(sourceUrl),
    careersUrl,
    hasPricingPage: Boolean(pricingUrl),
    pricingUrl,
    links: [...new Set(links)].slice(0, 25),
    truncated,
  };
}

/**
 * Converts findings into the `signals` object `create_lead` accepts.
 *
 * The rule that matters: a signal is `observed` only when the site said it. A
 * missing careers page is *not* `checked_absent` (plenty of companies hire
 * without a page), so hiring stays `not_checked`. This keeps the score honest
 * and is why an enriched lead can still be `INSUFFICIENT_DATA`.
 */
export function signalsFromResearch(research: CompanySiteResearch) {
  const signals: Record<string, unknown> = {};
  if (research.cloud) {
    signals.cloudFootprint = { value: research.cloud.value, state: "observed", observedAt: new Date().toISOString() };
  }
  const publicPain = research.pains.find((pain) => pain.value === "migration")
    ?? research.pains.find((pain) => pain.value === "cost")
    ?? research.pains.find((pain) => pain.value === "compliance")
    ?? research.pains.find((pain) => pain.value === "outage");
  if (publicPain) {
    signals.publicPain = { value: publicPain.value, state: "observed", observedAt: new Date().toISOString() };
  }
  return signals;
}

/** Evidence rows for `create_lead`, so every claim keeps its quote. */
export function evidenceFromResearch(research: CompanySiteResearch) {
  const evidence: Array<{ url?: string; quote?: string }> = [];
  if (research.title) evidence.push({ url: research.finalUrl ?? undefined, quote: `Site title: ${research.title}` });
  if (research.cloud) evidence.push({ url: research.cloud.sourceUrl, quote: research.cloud.quote });
  if (research.industry) evidence.push({ url: research.industry.sourceUrl, quote: research.industry.quote });
  for (const pain of research.pains.slice(0, 2)) {
    evidence.push({ url: pain.sourceUrl, quote: pain.quote });
  }
  return evidence.slice(0, 6);
}
