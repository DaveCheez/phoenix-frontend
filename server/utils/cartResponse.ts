import type { H3Event } from "h3";
import { setResponseHeader } from "h3";

export function markCartResponsePrivate(event: H3Event): void {
  setResponseHeader(
    event,
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate",
  );
  setResponseHeader(event, "Pragma", "no-cache");
  setResponseHeader(event, "Vary", "Cookie");
}
