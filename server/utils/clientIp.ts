import { isIP } from "node:net";
import { getRequestHeader, getRequestIP, type H3Event } from "h3";

const IPV4_MAPPED_PREFIX = /^::ffff:/i;

/**
 * Accept exactly one IPv4 or IPv6 address. Reject comma-separated lists,
 * extra tokens, and empty values. Map ::ffff:x.x.x.x and ::1 to 127.0.0.1
 * where that address is the IPv4 or IPv6 loopback form.
 */
export function canonicalizeSingleIp(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(",") || /\s/.test(trimmed)) {
    return null;
  }

  let candidate = trimmed;
  if (IPV4_MAPPED_PREFIX.test(candidate)) {
    const mapped = candidate.replace(IPV4_MAPPED_PREFIX, "");
    if (isIP(mapped) === 4) {
      candidate = mapped;
    }
  }

  if (isIP(candidate) === 0) return null;
  if (candidate.toLowerCase() === "::1") return "127.0.0.1";
  return candidate;
}

/**
 * Trusted client IP for Django rate limiting.
 * DigitalOcean: only a single valid `do-connecting-ip`.
 * Nuxt development: H3 direct address, otherwise 127.0.0.1.
 * An invalid platform header is never replaced by another source.
 * Never uses X-Forwarded-For or the request body.
 */
export function resolveTrustedClientIp(event: H3Event): string | null {
  const platformHeader = getRequestHeader(event, "do-connecting-ip");

  if (platformHeader !== undefined) {
    return canonicalizeSingleIp(platformHeader);
  }

  if (!import.meta.dev) {
    return null;
  }

  const directIp = getRequestIP(event, {
    xForwardedFor: false,
  });

  return canonicalizeSingleIp(directIp) ?? "127.0.0.1";
}
