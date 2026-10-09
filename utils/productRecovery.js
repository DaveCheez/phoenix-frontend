import { customerMessage, logCartFailure, PREFLIGHT_MESSAGE } from "./cartClient.js";

const NOTICE_OWNED = new Set([
  "uncertain",
  "access_unavailable",
  "missing_cart",
  "legacy",
  "locks_unavailable",
]);

const PREPARATION_CODES = new Set(["CART_PREFLIGHT", "CART_NOT_READY"]);

export function recoveryFeedbackMessage(error) {
  const outcome = error?.cartOutcome;
  const code = error?.cartCode;
  if (!outcome || NOTICE_OWNED.has(outcome) || code === "CART_LOCKS_UNAVAILABLE") return "";
  if (outcome === "preflight" && PREPARATION_CODES.has(code)) return PREFLIGHT_MESSAGE;
  if (outcome === "preflight") return "";
  return customerMessage(outcome, code);
}

export async function runProductRecovery({ recover, feedback }) {
  feedback.value = "";
  try {
    const result = await recover();
    if (result?.ok === true) feedback.value = "";
    return result ?? { ok: false };
  } catch (error) {
    logCartFailure("cart-start", error);
    feedback.value = recoveryFeedbackMessage(error);
    return { ok: false };
  }
}
