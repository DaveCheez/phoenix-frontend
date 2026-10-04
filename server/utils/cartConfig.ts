const SECRET_PATTERN = /^[0-9a-f]{64}$/i;

export type CartConfig = {
  secret: string;
  origin: string;
  host: string;
  dev: boolean;
};

export function isPlaceholderSecret(value: string): boolean {
  if (!SECRET_PATTERN.test(value)) return true;
  return /^(.)\1{63}$/.test(value.toLowerCase());
}

export function parseCartOrigin(
  value: unknown,
  dev: boolean,
): URL | null {
  const text = String(value || "").trim();
  if (!text) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.origin !== text || url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  if (
    dev &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return url;
  }
  return null;
}

export function logCartEvent(category: string, status?: number): void {
  if (typeof status === "number") {
    console.error(`Cart ${category}`, status);
    return;
  }
  console.error(`Cart ${category}`);
}
