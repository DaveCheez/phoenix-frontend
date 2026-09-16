import { computed } from "vue";

let cartCreationPromise = null;
let cartLoadPromise = null;
let mutationQueue = Promise.resolve();
let loadSequence = 0;

const CART_STORAGE_KEY = "phoenix_cart_id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const errorMessage = (error, fallback) =>
  error?.data?.error ||
  error?.data?.statusMessage ||
  error?.statusMessage ||
  error?.message ||
  fallback;

const normaliseCartId = (value) => {
  if (typeof value !== "string") return null;
  const candidate = value.trim().replace(/^"|"$/g, "");
  return UUID_PATTERN.test(candidate) ? candidate : null;
};

const readStoredCartId = () => {
  if (!import.meta.client) return null;

  try {
    return normaliseCartId(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return null;
  }
};

const writeStoredCartId = (cartId) => {
  if (!import.meta.client) return;

  try {
    const validId = normaliseCartId(cartId);
    if (validId) window.localStorage.setItem(CART_STORAGE_KEY, validId);
    else window.localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    // The cart still works through the HttpOnly server cookie when storage is
    // unavailable, for example in a privacy-restricted browser context.
  }
};

export function useCart() {
  const cartItems = useState("cart-items", () => []);
  const cartTotal = useState("cart-total", () => "0.00");
  const cartIdState = useState("cart-id", () => null);
  const isCartLoading = useState("cart-loading", () => false);
  const activeMutations = useState("cart-active-mutations", () => 0);
  const pendingItemIds = useState("cart-pending-items", () => ({}));
  const cartError = useState("cart-error", () => "");

  const cartItemCount = computed(() =>
    cartItems.value.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0,
    ),
  );
  const isCartMutating = computed(() => activeMutations.value > 0);

  const rememberCartId = (cartId) => {
    const validId = normaliseCartId(cartId);
    if (!validId) return null;

    cartIdState.value = validId;
    writeStoredCartId(validId);
    return validId;
  };

  const getCartId = () =>
    normaliseCartId(cartIdState.value) || readStoredCartId();

  const applyCart = (cart) => {
    if (!cart || !Array.isArray(cart.items)) return false;

    rememberCartId(cart.id || getCartId());
    cartItems.value = cart.items;
    cartTotal.value = String(cart.total ?? "0.00");
    cartError.value = "";
    return true;
  };

  const resetCartState = ({ clearStoredId = false } = {}) => {
    cartItems.value = [];
    cartTotal.value = "0.00";
    cartIdState.value = null;
    cartError.value = "";
    if (clearStoredId) writeStoredCartId(null);
  };

  /**
   * Keep two compatible identifiers for an anonymous cart:
   * 1. the HttpOnly cookie owned by the Nuxt server; and
   * 2. a UUID in localStorage that is sent explicitly with every request.
   *
   * The explicit UUID prevents a dropped, stale or host-specific cookie from
   * causing the add and read requests to operate on different carts.
   */
  const ensureCartExists = async () => {
    const existingCartId = getCartId();
    if (existingCartId) {
      rememberCartId(existingCartId);
      return existingCartId;
    }

    if (!cartCreationPromise) {
      cartCreationPromise = $fetch("/api/cart/create", {
        method: "POST",
        credentials: "same-origin",
      })
        .then((response) => {
          if (response?.success === false || !response?.cart_id) {
            throw new Error(
              response?.error || "Cart ID was not returned by the API",
            );
          }

          const cartId = rememberCartId(response.cart_id);
          if (!cartId) throw new Error("The cart API returned an invalid cart ID");
          if (response.cart) applyCart(response.cart);
          return cartId;
        })
        .finally(() => {
          cartCreationPromise = null;
        });
    }

    return await cartCreationPromise;
  };

  const loadCart = async ({ force = false, retry = true } = {}) => {
    if (cartLoadPromise && !force) return await cartLoadPromise;

    const requestNumber = ++loadSequence;
    isCartLoading.value = true;

    const run = async () => {
      try {
        const cartId = await ensureCartExists();
        const data = await $fetch("/api/cart", {
          method: "GET",
          query: { cart_id: cartId },
          credentials: "same-origin",
          cache: "no-store",
        });

        if (data?.success === false) {
          if (retry && data.code === "CART_NOT_FOUND") {
            resetCartState({ clearStoredId: true });
            return await loadCart({ force: true, retry: false });
          }
          throw new Error(data.error || "The cart could not be loaded");
        }

        if (!data?.cart || !Array.isArray(data.cart.items)) {
          throw new Error("The cart API returned an invalid response");
        }

        if (requestNumber === loadSequence) applyCart(data.cart);
        return data;
      } catch (error) {
        const message = errorMessage(error, "The cart could not be loaded");
        cartError.value = message;
        console.error("Failed to load cart:", error);
        throw error;
      } finally {
        if (requestNumber === loadSequence) isCartLoading.value = false;
      }
    };

    const currentPromise = run();
    cartLoadPromise = currentPromise;

    try {
      return await currentPromise;
    } finally {
      if (cartLoadPromise === currentPromise) cartLoadPromise = null;
    }
  };

  const markItemPending = (itemId, pending) => {
    if (!itemId) return;
    const key = String(itemId);
    const next = { ...pendingItemIds.value };
    if (pending) next[key] = true;
    else delete next[key];
    pendingItemIds.value = next;
  };

  const enqueueMutation = (operation, itemId = null) => {
    activeMutations.value += 1;
    markItemPending(itemId, true);

    const task = mutationQueue.then(operation, operation);
    mutationQueue = task.catch(() => undefined);

    return task.finally(() => {
      activeMutations.value = Math.max(0, activeMutations.value - 1);
      markItemPending(itemId, false);
    });
  };

  const handleMutationResponse = async (response, fallbackMessage) => {
    if (response?.success === false) {
      throw new Error(response.error || fallbackMessage);
    }

    // A mutation invalidates any older GET that may still be in flight.
    loadSequence += 1;
    isCartLoading.value = false;

    if (response?.cart_id) rememberCartId(response.cart_id);

    if (!applyCart(response?.cart)) {
      await loadCart({ force: true });
    }

    return response;
  };

  const addToCart = async (productId, quantity = 1, options = {}) =>
    await enqueueMutation(async () => {
      const cartId = await ensureCartExists();
      const response = await $fetch("/api/cart/add", {
        method: "POST",
        credentials: "same-origin",
        body: {
          cart_id: cartId,
          product_id: productId,
          quantity: Number(quantity),
          options,
        },
      });
      return await handleMutationResponse(
        response,
        "The item could not be added",
      );
    });

  const updateCartItem = async (itemId, quantity) =>
    await enqueueMutation(async () => {
      const cartId = await ensureCartExists();
      const response = await $fetch("/api/cart/update", {
        method: "POST",
        credentials: "same-origin",
        body: {
          item_id: itemId,
          cart_id: cartId,
          quantity: Number(quantity),
        },
      });
      return await handleMutationResponse(
        response,
        "The cart item could not be updated",
      );
    }, itemId);

  const removeFromCart = async (itemId) =>
    await enqueueMutation(async () => {
      const cartId = await ensureCartExists();
      const response = await $fetch("/api/cart/remove", {
        method: "POST",
        credentials: "same-origin",
        body: { item_id: itemId, cart_id: cartId },
      });
      return await handleMutationResponse(
        response,
        "The item could not be removed",
      );
    }, itemId);

  const clearCart = async () =>
    await enqueueMutation(async () => {
      const cartId = await ensureCartExists();
      const response = await $fetch("/api/cart/clear", {
        method: "DELETE",
        credentials: "same-origin",
        body: { cart_id: cartId },
      });
      return await handleMutationResponse(
        response,
        "The cart could not be cleared",
      );
    });

  const isItemPending = (itemId) =>
    Boolean(pendingItemIds.value[String(itemId)]);

  return {
    cartItems,
    cartTotal,
    cartItemCount,
    cartError,
    isCartLoading,
    isCartMutating,
    pendingItemIds,
    isItemPending,
    getCartId,
    loadCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    ensureCartExists,
    resetCartState,
  };
}
