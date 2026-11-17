/**
 * Turning an inbound email into a lead.
 *
 * A mailbox is a firehose: bounces, auto-replies, our own staff, invoice robots
 * and newsletter signups all arrive in it. Writing every message into the
 * pipeline would fill it with rows nobody can sell to and, worse, make the score
 * meaningless because most of them are noise.
 *
 * Everything here is a pure function over the message, so the guard rules can be
 * tested without a mail provider, a database or a language model. The caller only
 * performs writes after `classifyInboundEmail` says the message is a prospect.
 */

export interface InboundEmail {
  from: string;
  fromName?: string;
  to?: string;
  subject?: string;
  text?: string;
}

export type EmailRejection =
  | "invalid_sender"
  | "automated_sender"
  | "internal_sender"
  | "auto_reply"
  | "bounce_or_notice"
  | "empty_body";

export interface EmailClassification {
  accepted: boolean;
  reason?: EmailRejection;
  /** Human-readable explanation, shown in logs and in the provider's response. */
  detail?: string;
  lead?: {
    title: string;
    email: string;
    companyName: string | null;
    notes: string;
    /** Addresses that arrived from a free mailbox cannot be verified to a company. */
    freeMailOnly: boolean;
  };
}

/** Mailboxes that never belong to a buyer. */
const AUTOMATED_LOCAL_PARTS = [
  "no-reply", "noreply", "no_reply", "donotreply", "do-not-reply", "do_not_reply",
  "mailer-daemon", "postmaster", "bounce", "bounces", "notifications", "notification",
  "notify", "alerts", "alert", "automated", "system", "robot", "daemon", "abuse",
  "support-ticket", "ticketsystem", "newsletter",
];

/** Consumer mailboxes: a real person, but no company to attribute. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.in", "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me", "zoho.com", "gmx.com", "mail.com",
  "yandex.com", "rediffmail.com", "qq.com", "163.com",
]);

/** Subject or body patterns that mean "a machine wrote this". */
const AUTO_REPLY_PATTERNS = [
  /out of (the )?office/i,
  /automatic reply/i,
  /auto(matic)?[- ]?response/i,
  /auto[- ]?reply/i,
  /on (annual |parental |sick )?leave/i,
  /i am currently (away|unavailable)/i,
  /this is an automated (message|response)/i,
];

const BOUNCE_PATTERNS = [
  /delivery status notification/i,
  /undeliverable/i,
  /returned mail/i,
  /mail delivery (failed|subsystem)/i,
  /failure notice/i,
  /message not delivered/i,
];

function parseAddress(raw: string): { email: string; name: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // "Ana Ruiz <ana@acme.com>" or a bare address.
  const angled = value.match(/<([^>]+)>/);
  const email = (angled?.[1] ?? value).trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  const name = angled ? value.slice(0, value.indexOf("<")).trim().replace(/^"|"$/g, "") : "";
  return { email, name };
}

/** "northwind.io" → "Northwind". A hint, not a verified company name. */
function companyFromDomain(domain: string): string | null {
  const label = domain.split(".")[0];
  if (!label || label.length < 2) return null;
  if (["mail", "email", "smtp", "mx", "www", "web"].includes(label)) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Drops quoted reply chains so notes are about this message, not the history. */
function trimQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^>/.test(line.trim())) break;
    if (/^-{2,}\s*original message/i.test(line)) break;
    if (/^on .+ wrote:$/i.test(line.trim())) break;
    if (/^_{5,}$/.test(line.trim())) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function classifyInboundEmail(
  message: InboundEmail,
  options: { internalDomains?: string[] } = {}
): EmailClassification {
  const sender = parseAddress(message.from);
  if (!sender) {
    return { accepted: false, reason: "invalid_sender", detail: "The From address could not be parsed." };
  }

  const [localPart, domain] = sender.email.split("@");
  const internal = new Set([
    ...(options.internalDomains ?? []).map((entry) => entry.toLowerCase()),
    // Our own domain is never a prospect.
    "cyraops.com",
  ]);
  if (internal.has(domain)) {
    return { accepted: false, reason: "internal_sender", detail: `${domain} is one of our own domains.` };
  }

  if (AUTOMATED_LOCAL_PARTS.some((part) => localPart === part || localPart.startsWith(`${part}+`) || localPart.startsWith(`${part}-`))) {
    return { accepted: false, reason: "automated_sender", detail: `${localPart}@${domain} is an automated mailbox.` };
  }

  const subject = (message.subject ?? "").trim();
  const haystack = `${subject}\n${message.text ?? ""}`;
  if (BOUNCE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { accepted: false, reason: "bounce_or_notice", detail: "This is a delivery notice, not a message." };
  }
  if (AUTO_REPLY_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { accepted: false, reason: "auto_reply", detail: "This looks like an out-of-office or automatic reply." };
  }

  const body = trimQuoted(message.text ?? "");
  if (!body) {
    return { accepted: false, reason: "empty_body", detail: "The message had no readable body." };
  }

  const freeMailOnly = FREE_MAIL_DOMAINS.has(domain);
  const displayName = (message.fromName ?? sender.name ?? "").trim();
  const title = displayName || localPart.split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

  const notes = [
    `Inbound email from ${sender.email}`,
    subject ? `Subject: ${subject.slice(0, 200)}` : "",
    body.slice(0, 2000),
  ].filter(Boolean).join("\n\n");

  return {
    accepted: true,
    lead: {
      title: title.slice(0, 180),
      email: sender.email,
      companyName: freeMailOnly ? null : companyFromDomain(domain),
      notes,
      freeMailOnly,
    },
  };
}

/**
 * Signals a real inbound message justifies.
 *
 * `reachable: verified` is honest — the address demonstrably delivers. Everything
 * else (intent, authority, budget) is not knowable from an email arriving, so it
 * stays unchecked and the lead can still be `INSUFFICIENT_DATA`.
 */
export function signalsFromEmail(classification: EmailClassification) {
  if (!classification.accepted || !classification.lead) return {};
  return {
    reachable: { value: "verified", state: "observed" as const, observedAt: new Date().toISOString() },
    ...(classification.lead.freeMailOnly
      ? { knockout: { freeMailOnly: true } }
      : {}),
  };
}
