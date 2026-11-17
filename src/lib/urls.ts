/**
 * Cyraops Canonical Application URL Helper
 *
 * Validates and normalizes configured application base URLs (APP_URL)
 * to ensure setup and invitation links are secure, canonical, and portable.
 */

export type CanonicalUrlResult = {
  isValid: boolean;
  baseUrl?: string;
  error?: string;
};

/**
 * Checks whether a hostname belongs to a private network, loopback address,
 * or local testing domain.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  if (!hostname) return false;

  // Strip IPv6 brackets if present (e.g. [::1] -> ::1)
  const cleanHost = hostname.replace(/^\[|\]$/g, "").toLowerCase().trim();

  // Known local and development domain suffixes
  if (
    cleanHost === "localhost" ||
    cleanHost === "127.0.0.1" ||
    cleanHost === "::1" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost.endsWith(".test")
  ) {
    return true;
  }

  // IPv4 private ranges (RFC 1918 + RFC 3927 Link-Local + Loopback)
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = cleanHost.match(ipv4Regex);
  if (match) {
    const octets = match.slice(1, 5).map(Number);
    if (octets.some((oct) => oct > 255)) return false;

    const [o1, o2] = octets;
    if (o1 === 127) return true; // 127.0.0.0/8 Loopback
    if (o1 === 10) return true; // 10.0.0.0/8 Private
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12 Private
    if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16 Private
    if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 Link-Local
  }

  return false;
}

/**
 * Validates the raw APP_URL string according to security and environment rules.
 *
 * Rules:
 * Production (isProduction = true):
 * 1. Require a valid absolute HTTPS APP_URL.
 * 2. Reject every HTTP URL, including localhost, loopback, private LAN, link-local, and .local addresses.
 * 3. Reject missing, malformed, or unsupported APP_URL values.
 * 4. Do not merely log a warning and continue.
 * 5. Do not use relative URL fallback.
 * 6. Do not derive the canonical URL from Host or forwarded-host headers.
 *
 * Development (isProduction = false):
 * 1. Preserve currently supported HTTPS URLs.
 * 2. Preserve explicitly permitted local/LAN HTTP URLs.
 * 3. Preserve relative fallback only when APP_URL is omitted.
 * 4. Reject invalid schemes, embedded credentials, and query/hash values.
 */
export function validateAppUrl(
  rawUrl?: string | null,
  isProduction = process.env.NODE_ENV === "production"
): CanonicalUrlResult {
  const trimmed = rawUrl?.trim();

  // Missing or empty APP_URL
  if (!trimmed) {
    if (isProduction) {
      return {
        isValid: false,
        error: "APP_URL is required in production to generate reachable invitation links",
      };
    }
    // In local development, an omitted APP_URL permits relative fallback
    return {
      isValid: true,
      baseUrl: undefined,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      error: "Invalid URL format",
    };
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      error: "URLs with embedded credentials are not allowed",
    };
  }

  // Reject query params or hash fragments
  if (parsed.search || parsed.hash) {
    return {
      isValid: false,
      error: "Base APP_URL cannot include query parameters or fragments",
    };
  }

  const protocol = parsed.protocol.toLowerCase();

  if (isProduction) {
    // Production strictly requires HTTPS
    if (protocol !== "https:") {
      return {
        isValid: false,
        error: "Production requires a valid absolute HTTPS APP_URL",
      };
    }

    // In production, reject every local, loopback, private LAN, link-local, and .local address
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return {
        isValid: false,
        error: "Production APP_URL cannot be localhost, loopback, private LAN, link-local, or .local address",
      };
    }
  } else {
    // Development mode
    if (protocol === "https:") {
      // HTTPS is always accepted
    } else if (protocol === "http:") {
      // HTTP is permitted ONLY for loopback or private LAN testing
      if (!isPrivateOrLocalHost(parsed.hostname)) {
        return {
          isValid: false,
          error: "HTTP is only permitted for localhost or private LAN testing; use HTTPS for non-local addresses",
        };
      }
    } else {
      return {
        isValid: false,
        error: `Unsupported scheme "${protocol}". Only HTTPS (or local/LAN HTTP) is allowed`,
      };
    }
  }

  // Normalize trailing slashes
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const normalizedBase = `${parsed.origin}${pathname}`;

  return {
    isValid: true,
    baseUrl: normalizedBase,
  };
}

/**
 * Constructs a secure setup URL for an invitation token.
 *
 * Uses the canonical base URL if configured and valid; falls back to a relative path
 * ONLY in local development when APP_URL is unset. Returns null if validation fails.
 */
export function buildSetupUrl(
  token: string,
  explicitAppUrl?: string | null,
  isProduction = process.env.NODE_ENV === "production"
): string | null {
  const targetToken = token.trim();
  if (!targetToken) return null;

  const configuredUrl = explicitAppUrl !== undefined ? explicitAppUrl : process.env.APP_URL;
  const validation = validateAppUrl(configuredUrl, isProduction);

  if (!validation.isValid) {
    return null;
  }

  const path = `/setup?token=${encodeURIComponent(targetToken)}`;
  if (validation.baseUrl) {
    return `${validation.baseUrl}${path}`;
  }

  // Relative fallback is ONLY permitted in development when APP_URL is omitted
  if (!isProduction) {
    return path;
  }

  return null;
}
