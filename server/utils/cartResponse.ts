import type { H3Event } from "h3";

import { writeCartCacheHeaders } from "./cartCachePolicy";

export function markCartResponsePrivate(event: H3Event): void {
  writeCartCacheHeaders(event);
}
