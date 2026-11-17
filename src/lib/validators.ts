import { z } from "zod";

export const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12, "Use at least 12 characters").max(128);
export const nameSchema = z.string().trim().min(2).max(80);
export const taskStatusSchema = z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
/** BUG = something broken, SERVICE = agreed work, CATEGORY = grouping item. */
export const taskKindSchema = z.enum(["BUG", "SERVICE", "CATEGORY"]);
/** Service-desk properties, so a task can be worked as a ticket. */
export const taskSourceSchema = z.enum(["EMAIL", "PHONE", "CHAT", "WEB", "PORTAL", "API"]);
export const taskTypeSchema = z.enum(["SERVICE_REQUEST", "INCIDENT", "PROBLEM", "CHANGE"]);
export const projectStatusSchema = z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]);

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * Turns a zod failure into one human-readable line so the UI can name the
 * offending field instead of showing a generic "check the details".
 */
export function firstFieldError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Check the details";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

/**
 * Strict validator for external URLs.
 * Rules:
 * - Allows null, undefined, or empty string (optional fields).
 * - Must be an absolute URL parseable by standard URL parser.
 * - Allowed protocols: strictly "http:" or "https:".
 * - Rejects "javascript:", "data:", "vbscript:", "file:", "ftp:", and any other scheme.
 * - Rejects protocol-relative URLs (e.g. "//evil.com").
 * - Rejects embedded credentials (username or password).
 * - Rejects malformed URLs and missing hostnames.
 */
export function isValidExternalUrl(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") return true;

  // Reject protocol-relative URLs
  if (trimmed.startsWith("//")) return false;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }
    if (!parsed.hostname || parsed.hostname.trim() === "") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const externalUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((val) => isValidExternalUrl(val), {
    message: "External URL must be a valid absolute HTTP or HTTPS URL without embedded credentials",
  })
  .optional()
  .nullable()
  .or(z.literal(""));

