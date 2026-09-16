import { computed } from "vue";

let cartCreationPromise = null;
let cartLoadPromise = null;
let mutationQueue = Promise.resolve();
let loadSequence = 0;

const errorMessage = (error, fallback) =>
  error?.data?.error ||
  error?.data?.statusMessage ||
  error?.statusMessage ||
  error?.message ||
  fallback;

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

  const applyCart = (cart) => {
    if (!cart || !Array.isArray(cart.items)) return false;

    cartIdState.value = cart.id || cartIdState.value;
    cartItems.value = cart.items;
    cartTotal.value = String(cart.total ?? "0.00");
    cartError.value = "";
    return true;
  };

  const resetCartState = () => {
    cartItems.value = [];
    cartTotal.value = "0.00";
    cartIdState.value = null;
    cartError.value = "";
  };

  /**
   * The Nuxt server owns the anonymous cart cookie. Browser code does not need
   * to read or write the cart UUID, which avoids stale/JSON-encoded cookie
   * mismatches after a deployment or database change.
   */
  const ensureCartExists = async () => {
    if (cartIdState.value) return cartIdState.value;

    if (!cartCreationPromise) {
      cartCreationPromise = $fetch("/api/cart/create", { method: "POST" })
        .then((response) => {
          if (response?.success === false || !response?.cart_id) {
            throw new Error(
              response?.error || "Cart ID was not returned by the API",
            );
          }

          cartIdState.value = response.cart_id;
          if (response.cart) applyCart(response.cart);
          return response.cart_id;
        })
        .finally(() => {
          cartCreationPromise = null;
        });
    }

    return await cartCreationPromise;
  };

  const loadCart = async ({ force = false } = {}) => {
    if (cartLoadPromise && !force) return await cartLoadPromise;

    const requestNumber = ++loadSequence;
    isCartLoading.value = true;

    const run = async () => {
      try {
        await ensureCartExists();
        const data = await $fetch("/api/cart", { method: "GET" });

        if (data?.success === false) {
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

    cartLoadPromise = run().finally(() => {
      cartLoadPromise = null;
    });
    return await cartLoadPromise;
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

    if (!applyCart(response?.cart)) {
      await loadCart({ force: true });
    }

    return response;
  };

  const addToCart = async (productId, quantity = 1, options = {}) =>
    await enqueueMutation(async () => {
      await ensureCartExists();
      const response = await $fetch("/api/cart/add", {
        method: "POST",
        body: {
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
      await ensureCartExists();
      const response = await $fetch("/api/cart/update", {
        method: "POST",
        body: {
          item_id: itemId,
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
      await ensureCartExists();
      const response = await $fetch("/api/cart/remove", {
        method: "POST",
        body: { item_id: itemId },
      });
      return await handleMutationResponse(
        response,
        "The item could not be removed",
      );
    }, itemId);

  const clearCart = async () =>
    await enqueueMutation(async () => {
      await ensureCartExists();
      const response = await $fetch("/api/cart/clear", {
        method: "DELETE",
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
    loadCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    ensureCartExists,
    resetCartState,
  };
}
