import { ref } from "vue";

// Shared state across every component using this composable.
const cartItems = ref([]);
const cartTotal = ref("0.00");
const isCartLoading = ref(true);

const getCartId = () => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )cart_id=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

const ensureCartExists = async () => {
  const existingCartId = getCartId();
  if (existingCartId) return existingCartId;

  const response = await $fetch("/api/cart/create", { method: "POST" });
  if (!response?.cart_id) {
    throw new Error(response?.error || "Cart ID was not returned by the API");
  }

  // The Nitro endpoint also sets this cookie. Setting it here makes the new
  // value immediately available to browser code without waiting for reload.
  document.cookie = `cart_id=${encodeURIComponent(response.cart_id)}; path=/; max-age=2592000; samesite=Lax`;
  return response.cart_id;
};

export function useCart() {
  const loadCart = async () => {
    isCartLoading.value = true;
    try {
      const cartId = await ensureCartExists();
      const data = await $fetch(`/api/cart?cart_id=${encodeURIComponent(cartId)}`);
      if (data?.success === false) {
        throw new Error(data.error || "The cart could not be loaded");
      }
      cartItems.value = data?.cart?.items || [];
      cartTotal.value = data?.cart?.total || "0.00";
    } catch (error) {
      console.error("Failed to load cart:", error);
      cartItems.value = [];
      cartTotal.value = "0.00";
    } finally {
      isCartLoading.value = false;
    }
  };

  const addToCart = async (productId, quantity = 1, options = {}) => {
    try {
      const cartId = await ensureCartExists();
      const response = await $fetch("/api/cart/add", {
        method: "POST",
        body: {
          cart_id: cartId,
          product_id: productId,
          quantity,
          options,
        },
      });
      if (response?.success === false) {
        throw new Error(response.error || "The item could not be added");
      }
      await loadCart();
      return response;
    } catch (error) {
      console.error("Cart error - failed to add item:", error);
      throw error;
    }
  };

  const updateCartItem = async (itemId, quantity) => {
    const cartId = getCartId();
    if (!cartId) throw new Error("Cart ID is missing");

    const response = await $fetch("/api/cart/update", {
      method: "POST",
      body: { item_id: itemId, cart_id: cartId, quantity },
    });
    if (response?.success === false) {
      throw new Error(response.error || "The cart item could not be updated");
    }
    await loadCart();
    return response;
  };

  const removeFromCart = async (itemId) => {
    try {
      const cartId = getCartId();
      if (!cartId) throw new Error("Cart ID is missing");

      const response = await $fetch("/api/cart/remove", {
        method: "POST",
        body: { item_id: itemId, cart_id: cartId },
      });
      if (response?.success === false) {
        throw new Error(response.error || "The cart item could not be removed");
      }
      await loadCart();
      return response;
    } catch (error) {
      console.error("Failed to remove item from cart:", error);
      throw error;
    }
  };

  return {
    cartItems,
    cartTotal,
    isCartLoading,
    loadCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    ensureCartExists,
  };
}
