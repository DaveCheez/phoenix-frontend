import {
  defineEventHandler,
  getRequestHeader,
  readBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { useRuntimeConfig } from "#imports";

import { resolveTrustedClientIp } from "../utils/clientIp";
import { djangoFetch } from "../utils/django";

const ALLOWED_FIELDS = [
  "name",
  "email",
  "phone",
  "message",
  "website",
  "source_url",
] as const;

const LIMITS = {
  name: 120,
  email: 254,
  phone: 50,
  message: 5000,
  website: 200,
  source_url: 2048,
} as const;

const SERVICE_UNAVAILABLE = {
  success: false,
  code: "CONTACT_SERVICE_UNAVAILABLE",
  error:
    "We could not send your enquiry right now. Please try again shortly or contact Phoenix Vanz by phone.",
};

function markPrivate(event: H3Event): void {
  setResponseHeader(
    event,
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate",
  );
  setResponseHeader(event, "Pragma", "no-cache");
}

function serviceUnavailable(event: H3Event) {
  setResponseStatus(event, 503);
  return SERVICE_UNAVAILABLE;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function refererSourceUrl(event: H3Event): string {
  const referer = getRequestHeader(event, "referer");
  const value = Array.isArray(referer) ? "" : String(referer || "").trim();
  if (!value || value.length > LIMITS.source_url || !isHttpUrl(value)) {
    return "";
  }
  return value;
}

function lightweightValidation(payload: {
  name: string;
  email: string;
  phone: string;
  message: string;
  website: string;
  source_url: string;
}): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};

  if (!payload.name) {
    errors.name = ["Enter your name."];
  } else if (payload.name.length > LIMITS.name) {
    errors.name = [`Name must be ${LIMITS.name} characters or fewer.`];
  }

  if (!payload.email) {
    errors.email = ["Enter your email address."];
  } else if (payload.email.length > LIMITS.email || !payload.email.includes("@")) {
    errors.email = ["Enter a valid email address."];
  }

  if (payload.phone.length > LIMITS.phone) {
    errors.phone = [`Phone must be ${LIMITS.phone} characters or fewer.`];
  }

  if (!payload.message) {
    errors.message = ["Enter a message."];
  } else if (payload.message.length > LIMITS.message) {
    errors.message = [`Message must be ${LIMITS.message} characters or fewer.`];
  }

  if (payload.website.length > LIMITS.website) {
    errors.website = ["This field is invalid."];
  }

  if (payload.source_url && !isHttpUrl(payload.source_url)) {
    errors.source_url = ["Enter a valid URL."];
  } else if (payload.source_url.length > LIMITS.source_url) {
    errors.source_url = ["This field is invalid."];
  }

  return Object.keys(errors).length ? errors : null;
}

function upstreamStatus(error: any): number {
  return Number(
    error?.response?.status ||
      error?.statusCode ||
      error?.status ||
      error?.cause?.statusCode ||
      0,
  );
}

export default defineEventHandler(async (event) => {
  markPrivate(event);

  const runtimeConfig = useRuntimeConfig(event);
  const secret = String(runtimeConfig.contactProxySecret || "").trim();
  if (!secret) {
    console.error("[contact proxy]", {
      errorClass: "missing_contact_proxy_secret",
    });
    return serviceUnavailable(event);
  }

  const clientIp = resolveTrustedClientIp(event);
  if (!clientIp) {
    console.error("[contact proxy]", {
      errorClass: "untrusted_client_ip",
    });
    return serviceUnavailable(event);
  }

  const rawBody = await readBody(event).catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    setResponseStatus(event, 400);
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "Please correct the highlighted fields.",
      errors: { name: ["Enter your name."] },
    };
  }

  const body = rawBody as Record<string, unknown>;
  const payload = {
    name: asTrimmedString(body.name),
    email: asTrimmedString(body.email),
    phone: asTrimmedString(body.phone),
    message: asTrimmedString(body.message),
    website: asTrimmedString(body.website),
    source_url: asTrimmedString(body.source_url) || refererSourceUrl(event),
  };

  const fieldErrors = lightweightValidation(payload);
  if (fieldErrors) {
    setResponseStatus(event, 400);
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "Please correct the highlighted fields.",
      errors: fieldErrors,
    };
  }

  const djangoBody: Record<string, string> = {};
  for (const field of ALLOWED_FIELDS) {
    djangoBody[field] = payload[field];
  }

  try {
    const data = await djangoFetch(event, "contact/", {
      method: "POST",
      body: djangoBody,
      headers: {
        "content-type": "application/json",
        "X-Phoenix-Contact-Secret": secret,
        "X-Phoenix-Client-IP": clientIp,
      },
    });

    setResponseStatus(event, 201);
    return data;
  } catch (error: any) {
    const status = upstreamStatus(error);
    const data = error?.data || error?.response?._data;

    if (status === 400 || status === 429) {
      setResponseStatus(event, status);
      return data && typeof data === "object" ? data : { success: false };
    }

    console.error("[contact proxy]", {
      upstreamStatus: status || null,
      errorClass: error?.name || "Error",
    });
    return serviceUnavailable(event);
  }
});
