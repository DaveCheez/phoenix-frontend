<script setup>
import { computed, onMounted } from "vue";

const {
  cartItems,
  cartTotal,
  cartError,
  isCartLoading,
  isCartMutating,
  isItemPending,
  loadCart,
  updateCartItem,
  removeFromCart,
} = useCart();
const toast = useToast();
const config = useRuntimeConfig();
const checkoutEnabled = computed(() =>
  config.public.checkoutEnabled === true ||
  String(config.public.checkoutEnabled).toLowerCase() === "true",
);

onMounted(async () => {
  try {
    await loadCart();
  } catch {
    toast.error("Your cart could not be loaded. Please refresh and try again.");
  }
});

const updateQuantity = async (item, requestedQuantity) => {
  const quantity = Number.parseInt(String(requestedQuantity), 10);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
    toast.error("Quantity must be a whole number between 0 and 999.");
    return false;
  }

  if (isItemPending(item.item_id)) return false;

  try {
    await updateCartItem(item.item_id, quantity);
    if (quantity === 0) toast.success(`${item.name} removed from your cart.`);
    else toast.success("Cart quantity updated.");
    return true;
  } catch (error) {
    console.error("Quantity update failed:", error);
    toast.error(error?.message || "Unable to update the cart.");
    return false;
  }
};

const handleQuantityInput = async (item, event) => {
  const value = event.target.value;
  const quantity = Number.parseInt(value, 10);

  if (!Number.isInteger(quantity) || quantity < 1) {
    event.target.value = item.quantity;
    toast.error("Quantity must be at least 1.");
    return;
  }

  const updated = await updateQuantity(item, quantity);
  const freshItem = cartItems.value.find(
    (cartItem) => cartItem.item_id === item.item_id,
  );
  event.target.value = updated ? freshItem?.quantity ?? quantity : item.quantity;
};

const removeItem = async (item) => {
  if (isItemPending(item.item_id)) return false;

  try {
    await removeFromCart(item.item_id);
    toast.success(`${item.name} removed from your cart.`);
  } catch (error) {
    console.error("Remove item failed:", error);
    toast.error(error?.message || "Unable to remove the item.");
  }
};
</script>

<template>
  <div class="container mx-auto px-4 py-8 pt-28">
    <h1 class="mb-6 text-center text-3xl font-bold">Your Shopping Cart</h1>

    <div v-if="isCartLoading" class="py-16 text-center" aria-live="polite">
      <Icon name="svg-spinners:ring-resize" class="mx-auto mb-3 h-8 w-8" />
      <p>Loading your cart...</p>
    </div>

    <div
      v-else-if="cartItems.length > 0"
      class="flex flex-col gap-8 lg:flex-row"
    >
      <div class="lg:w-2/3">
        <div class="rounded-lg bg-white p-6 shadow-md">
          <p
            v-if="cartError"
            class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {{ cartError }}
          </p>

          <ul>
            <li
              v-for="item in cartItems"
              :key="item.item_id"
              class="flex flex-col items-center justify-between border-b py-6 last:border-b-0 sm:flex-row sm:items-start"
              :class="{ 'opacity-60': isItemPending(item.item_id) }"
            >
              <div class="mb-4 flex items-start sm:mb-0">
                <NuxtLink
                  :to="`/product/${item.product_slug}`"
                  class="shrink-0"
                >
                  <img
                    :src="item.image || '/images/logo.png'"
                    :alt="item.name"
                    class="mr-6 h-24 w-24 rounded-md border object-cover"
                  />
                </NuxtLink>

                <div class="grow">
                  <NuxtLink
                    :to="`/product/${item.product_slug}`"
                    class="hover:text-blue-600"
                  >
                    <h2 class="text-lg font-semibold">{{ item.name }}</h2>
                  </NuxtLink>
                  <p v-if="item.sku" class="mt-1 text-sm text-gray-500">
                    SKU: {{ item.sku }}
                  </p>
                  <p class="mt-1 text-gray-700">
                    £{{ Number(item.price).toFixed(2) }} each
                  </p>

                  <div class="mt-4 flex items-center gap-2">
                    <span class="mr-1 text-sm font-medium text-gray-700">
                      Quantity
                    </span>
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-md border text-lg transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isItemPending(item.item_id)"
                      :aria-label="`Decrease ${item.name} quantity`"
                      @click="updateQuantity(item, item.quantity - 1)"
                    >
                      <Icon name="heroicons:minus" class="h-4 w-4" />
                    </button>
                    <input
                      :value="item.quantity"
                      type="number"
                      min="1"
                      max="999"
                      inputmode="numeric"
                      class="h-9 w-16 rounded-md border text-center"
                      :disabled="isItemPending(item.item_id)"
                      :aria-label="`${item.name} quantity`"
                      @change="handleQuantityInput(item, $event)"
                    />
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-md border text-lg transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isItemPending(item.item_id) || item.quantity >= 999"
                      :aria-label="`Increase ${item.name} quantity`"
                      @click="updateQuantity(item, item.quantity + 1)"
                    >
                      <Icon name="heroicons:plus" class="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div class="flex w-full flex-col items-end sm:w-auto">
                <p class="mb-2 text-lg font-semibold">
                  £{{
                    Number(
                      item.line_total ?? Number(item.price) * item.quantity,
                    ).toFixed(2)
                  }}
                </p>
                <button
                  type="button"
                  class="text-sm font-semibold text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="isItemPending(item.item_id)"
                  @click="removeItem(item)"
                >
                  {{ isItemPending(item.item_id) ? "Updating..." : "Remove" }}
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div class="lg:w-1/3">
        <div class="rounded-lg bg-white p-6 shadow-md lg:sticky lg:top-28">
          <h2 class="mb-4 text-2xl font-bold">Order Summary</h2>
          <div class="mb-2 flex justify-between">
            <span>Subtotal</span>
            <span>£{{ Number(cartTotal).toFixed(2) }}</span>
          </div>
          <div class="mb-4 flex justify-between">
            <span>Installation / delivery</span>
            <span>Confirmed separately</span>
          </div>
          <div
            class="mt-4 flex justify-between border-t pt-4 text-xl font-bold text-gray-800"
          >
            <span>Total</span>
            <span>£{{ Number(cartTotal).toFixed(2) }}</span>
          </div>
          <NuxtLink
            v-if="checkoutEnabled"
            to="/checkout"
            class="mt-6 block rounded-lg bg-blue-600 py-3 text-center font-semibold text-white transition hover:bg-blue-700"
            :class="{ 'pointer-events-none opacity-50': isCartMutating }"
          >
            Proceed to Checkout
          </NuxtLink>
          <NuxtLink
            v-else
            to="/contact"
            class="mt-6 block rounded-lg bg-blue-600 py-3 text-center font-semibold text-white transition hover:bg-blue-700"
          >
            Contact us to order
          </NuxtLink>
          <p v-if="!checkoutEnabled" class="mt-3 text-sm text-gray-600">
            Online payment is temporarily unavailable. We will confirm fitting,
            lead time and payment details directly with you.
          </p>
        </div>
      </div>
    </div>

    <div v-else class="py-16 text-center">
      <p class="mb-4 text-xl text-gray-600">Your cart is empty.</p>
      <NuxtLink
        to="/"
        class="rounded bg-gray-800 px-4 py-2 font-bold text-white hover:bg-gray-900"
      >
        Continue Shopping
      </NuxtLink>
    </div>
  </div>
</template>
