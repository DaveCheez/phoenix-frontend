import { createOrderController } from "~/utils/orderClient";

const ORDER_LOCK = "phoenix-guest-cart";
const LOCK_WAIT_MS = 15000;

let controller;

function browserStorage() {
  return {
    getItem(key) {
      if (!import.meta.client) return null;
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      if (!import.meta.client) return;
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // The in-memory attempt still prevents a second click in this page.
      }
    },
    removeItem(key) {
      if (!import.meta.client) return;
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore storage failures. Secrets are not stored here.
      }
    },
  };
}

async function nuxtFetch(path, options = {}) {
  const response = await $fetch.raw(path, options);
  return { status: response.status, _data: response._data };
}

export function useOrderSubmission() {
  const cart = useCart();
  if (!controller) {
    controller = createOrderController({
      fetch: nuxtFetch,
      locksAvailable: () => import.meta.client && typeof navigator !== "undefined" && typeof navigator.locks?.request === "function",
      lock: (task) => navigator.locks.request(
        ORDER_LOCK,
        { signal: AbortSignal.timeout(LOCK_WAIT_MS) },
        () => task(),
      ),
      storage: browserStorage(),
      refreshBasket: () => cart.refreshBasket(),
      cartState: () => ({
        cart: cart.cart.value,
        access: cart.access.value,
        pending: cart.pending.value,
      }),
    });
  }
  return controller;
}
