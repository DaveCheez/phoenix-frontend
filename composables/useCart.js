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

  const cartCookie = useCookie("cart_id", {
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: import.meta.client && window.location.protocol === "https:",
  });

  const cartItemCount = computed(() =>
    cartItems.value.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0,
    ),
  );
  const isCartMutating = computed(() => activeMutations.value > 0);

  const getCartId = () => cartIdState.value || cartCookie.value || null;

  const applyCart = (cart) => {
    if (!cart || !Array.isArray(cart.items)) return;

    cartIdState.value = cart.id || getCartId();
    if (cartIdState.value) cartCookie.value = cartIdState.value;
    cartItems.value = cart.items;
    cartTotal.value = String(cart.total ?? "0.00");
    cartError.value = "";
  };

  const resetCart = ({ clearCookie = false } = {}) => {
    cartItems.value = [];
    cartTotal.value = "0.00";
    cartIdState.value = null;
    cartError.value = "";
    if (clearCookie) cartCookie.value = null;
  };

  const ensureCartExists = async () => {
    const existingCartId = getCartId();
    if (existingCartId) return existingCartId;

    if (!cartCreationPromise) {
      cartCreationPromise = $fetch("/api/cart/create", { method: "POST" })
        .then((response) => {
          if (!response?.cart_id) {
            throw new Error(
              response?.error || "Cart ID was not returned by the API",
            );
          }

          cartIdState.value = response.cart_id;
          cartCookie.value = response.cart_id;
          if (response.cart) applyCart(response.cart);
          return response.cart_id;
        })
        .finally(() => {
          cartCreationPromise = null;
        });
    }

    return await cartCreationPromise;
  };

  const loadCart = async ({ force = false, allowCartReset = true } = {}) => {
    if (cartLoadPromise && !force) return await cartLoadPromise;

    const requestNumber = ++loadSequence;
    isCartLoading.value = true;

    const run = async () => {
      try {
        const cartId = await ensureCartExists();
        const data = await $fetch(
          `/api/cart?cart_id=${encodeURIComponent(cartId)}`,
        );

        if (data?.success === false) {
          if (data.code === "CART_NOT_FOUND" && allowCartReset) {
            resetCart({ clearCookie: true });
            await ensureCartExists();
            return await loadCart({ force: true, allowCartReset: false });
          }
          throw new Error(data.error || "The cart could not be loaded");
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

    if (response?.cart) {
      // Invalidate any older GET that may still be in flight so it cannot
      // overwrite the mutation response with stale cart data.
      loadSequence += 1;
      isCartLoading.value = false;
      applyCart(response.cart);
    } else {
      await loadCart({ force: true });
    }
    return response;
  };

  const addToCart = async (productId, quantity = 1, options = {}) =>
    await enqueueMutation(async () => {
      const cartId = await ensureCartExists();
      const response = await $fetch("/api/cart/add", {
        method: "POST",
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
      const cartId = getCartId() || (await ensureCartExists());
      const response = await $fetch("/api/cart/update", {
        method: "POST",
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
      const cartId = getCartId() || (await ensureCartExists());
      const response = await $fetch("/api/cart/remove", {
        method: "POST",
        body: { item_id: itemId, cart_id: cartId },
      });
      return await handleMutationResponse(response, "The item could not be removed");
    }, itemId);

  const clearCart = async () =>
    await enqueueMutation(async () => {
      const cartId = getCartId();
      if (!cartId) {
        resetCart({ clearCookie: true });
        return { success: true };
      }

      const response = await $fetch("/api/cart/clear", {
        method: "DELETE",
        body: { cart_id: cartId },
      });
      return await handleMutationResponse(response, "The cart could not be cleared");
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
  };
}
