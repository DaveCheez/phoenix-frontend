import { computed, reactive } from "vue";
import { createCartController } from "~/utils/cartClient";

const CART_LOCK = "phoenix-guest-cart";
const LEGACY_STORAGE_KEY = "phoenix_cart_id";
const LOCK_WAIT_MS = 15000;

const state = reactive({
  cart: null,
  access: "loading",
  pending: false,
});

let controller;
let channel = null;

function legacyPresent() {
  if (!import.meta.client) return false;
  try {
    return Boolean(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return false;
  }
}

function retireLegacy() {
  if (!import.meta.client) return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // The server retires the legacy cookie after a confirmed new session.
  }
}

function ensureChannel() {
  if (!import.meta.client || channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CART_LOCK);
  channel.onmessage = (event) => {
    if (event?.data?.type === "refresh") controller?.loadCart();
  };
}

function notifyRefresh() {
  ensureChannel();
  channel?.postMessage({ type: "refresh" });
}

async function nuxtFetch(path, options = {}) {
  const response = await $fetch.raw(path, options);
  return { status: response.status, _data: response._data };
}

function locksAvailable() {
  return import.meta.client && typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
}

function cartController() {
  if (!controller) {
    controller = createCartController({
      state,
      fetch: nuxtFetch,
      locksAvailable,
      lock: (task) => navigator.locks.request(
        CART_LOCK,
        { signal: AbortSignal.timeout(LOCK_WAIT_MS) },
        () => task(),
      ),
      legacyPresent,
      retireLegacy,
      ensureChannel,
      notify: notifyRefresh,
    });
  }
  return controller;
}

export function useCart() {
  const api = cartController();
  const totalItems = computed(() => {
    if (state.access !== "ready" && state.access !== "temporary") return 0;
    return (state.cart?.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  });
  const cartItems = computed(() => {
    if (state.access !== "ready" && state.access !== "temporary") return [];
    return state.cart?.items || [];
  });

  return {
    cart: computed(() => state.cart),
    access: computed(() => state.access),
    pending: computed(() => state.pending),
    lastError: computed(() => ""),
    totalItems,
    cartItems,
    cartTotal: computed(() => state.cart?.total ?? null),
    cartError: computed(() => ""),
    isCartLoading: computed(() => state.access === "loading"),
    isCartMutating: computed(() => state.pending),
    isItemPending: () => state.pending,
    cartItemCount: totalItems,
    loadCart: api.loadCart,
    startNewBasket: api.startNewBasket,
    openEmptyBasket: api.openEmptyBasket,
    refreshBasket: api.refreshBasket,
    recoverBasket: api.recoverBasket,
    addToCart: api.addToCart,
    adjustQuantity: api.adjustQuantity,
    updateQuantity: api.setQuantity,
    updateCartItem: api.setQuantity,
    removeItem: api.removeItem,
    removeFromCart: api.removeItem,
    clearCart: api.clearCart,
  };
}
