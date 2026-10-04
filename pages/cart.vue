<script setup>
import { computed, onMounted } from "vue";
import logoUrl from "~/assets/images/logo.png";
import { LAST_CONFIRMED_LABEL, logCartFailure } from "~/utils/cartClient";

const {
  access,
  pending,
  cartItems,
  cartTotal,
  cartError,
  isCartLoading,
  isCartMutating,
  isItemPending,
  loadCart,
  recoverBasket,
  adjustQuantity,
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
  } catch (error) {
    logCartFailure("cart-read", error);
    if (error?.cartCode === "CART_LOCKS_UNAVAILABLE") return;
    toast.error(error?.customerMessage || "Your cart could not be loaded. Please refresh and try again.");
  }
});

const reportCartFailure = (operation, error) => {
  logCartFailure(operation, error);
  toast.error(error?.customerMessage || "We could not confirm the latest basket update. Check your basket before trying the change again.");
};

const changeQuantity = async (item, delta) => {
  if (isItemPending(item.item_id)) return false;
  try {
    const result = await adjustQuantity(item.item_id, delta);
    if (result?.ok !== true) return false;
    toast.success(delta < 0 && result.cart?.items?.every((line) => line.item_id !== item.item_id)
      ? `${item.name} removed from your cart.`
      : "Cart quantity updated.");
    return true;
  } catch (error) {
    reportCartFailure("cart-update", error);
    return false;
  }
};

const updateQuantity = async (item, requestedQuantity) => {
  const quantity = Number.parseInt(String(requestedQuantity), 10);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
    toast.error("Quantity must be a whole number between 0 and 999.");
    return false;
  }

  if (isItemPending(item.item_id)) return false;

  try {
    const result = await updateCartItem(item.item_id, quantity);
    if (result?.ok !== true) return false;
    if (quantity === 0) toast.success(`${item.name} removed from your cart.`);
    else toast.success("Cart quantity updated.");
    return true;
  } catch (error) {
    reportCartFailure("cart-update", error);
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
    const result = await removeFromCart(item.item_id);
    if (result?.ok !== true) return false;
    toast.success(`${item.name} removed from your cart.`);
    return true;
  } catch (error) {
    reportCartFailure("cart-remove", error);
    return false;
  }
};

const serverMoney = (value) => {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return /^[0-9]+\.[0-9]{2}$/.test(text) ? text : null;
};

const moneyLabel = (value) => {
  const money = serverMoney(value);
  return money == null ? "Unavailable" : `£${money}`;
};

const optionAdjustmentLabel = (value) => {
  const money = serverMoney(value);
  if (money == null) return "Unavailable";
  return money === "0.00" ? "Included" : `+£${money}`;
};

const selectedOptions = (item) =>
  Array.isArray(item?.selected_options) ? item.selected_options : [];

const configuredUnitPrice = (item) =>
  item?.configured_unit_price ?? item?.price;

const lineTotalLabel = (item) => {
  const money = serverMoney(item?.line_total);
  return money == null ? "Unavailable" : `£${money}`;
};

const cartTotalLabel = computed(() => moneyLabel(cartTotal.value));
</script>

<template>
  <div class="container mx-auto px-4 py-8 pt-28">
    <h1 class="mb-6 text-center text-3xl font-bold">Your Shopping Cart</h1>

    <CartSessionNotice
      class="mb-6"
      :access="access"
      :pending="pending"
      @action="recoverBasket"
    />

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

          <p v-if="access === 'temporary'" class="mb-4 text-sm font-semibold text-amber-950">
            {{ LAST_CONFIRMED_LABEL }}
          </p>

          <ul>
            <li
              v-for="item in cartItems"
              :key="item.item_id"
              class="flex flex-col items-start justify-between gap-4 border-b py-6 last:border-b-0 sm:flex-row"
              :class="{ 'opacity-60': isItemPending(item.item_id) }"
            >
              <div class="flex min-w-0 flex-1 items-start">
                <NuxtLink
                  :to="`/product/${item.product_slug}`"
                  class="shrink-0"
                >
                  <img
                    :src="item.image || logoUrl"
                    :alt="item.name"
                    class="mr-6 h-24 w-24 rounded-md border object-cover"
                  />
                </NuxtLink>

                <div class="min-w-0 grow">
                  <NuxtLink
                    :to="`/product/${item.product_slug}`"
                    class="hover:text-blue-600"
                  >
                    <h2 class="break-words text-lg font-semibold">{{ item.name }}</h2>
                  </NuxtLink>
                  <p v-if="item.sku" class="mt-1 break-words text-sm text-gray-500">
                    SKU: {{ item.sku }}
                  </p>

                  <ul
                    v-if="selectedOptions(item).length"
                    class="mt-3 space-y-2"
                  >
                    <li
                      v-for="option in selectedOptions(item)"
                      :key="`${item.item_id}-${option.group_id}-${option.option_id}`"
                      class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-gray-700"
                    >
                      <span class="min-w-0 break-words">
                        {{ option.group_name }}: {{ option.option_name }}
                      </span>
                      <span class="shrink-0">
                        {{ optionAdjustmentLabel(option.price_adjustment) }}
                      </span>
                    </li>
                  </ul>

                  <p
                    v-if="item.configuration_valid === false"
                    class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
                    role="alert"
                  >
                    This product configuration is no longer valid. Remove the
                    item and configure the product again before ordering.
                  </p>

                  <dl class="mt-4 space-y-1 text-sm text-gray-700">
                    <div
                      v-if="serverMoney(item.base_unit_price)"
                      class="flex flex-wrap justify-between gap-x-3 gap-y-1"
                    >
                      <dt>Base unit price</dt>
                      <dd>{{ moneyLabel(item.base_unit_price) }}</dd>
                    </div>
                    <div
                      v-if="serverMoney(item.options_total)"
                      class="flex flex-wrap justify-between gap-x-3 gap-y-1"
                    >
                      <dt>Selected options</dt>
                      <dd>{{ moneyLabel(item.options_total) }}</dd>
                    </div>
                    <div
                      v-if="serverMoney(configuredUnitPrice(item))"
                      class="flex flex-wrap justify-between gap-x-3 gap-y-1"
                    >
                      <dt>Configured unit price</dt>
                      <dd>{{ moneyLabel(configuredUnitPrice(item)) }}</dd>
                    </div>
                    <div class="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <dt>Quantity</dt>
                      <dd>{{ item.quantity }}</dd>
                    </div>
                    <div class="flex flex-wrap justify-between gap-x-3 gap-y-1 font-semibold text-gray-900">
                      <dt>Line total</dt>
                      <dd>{{ lineTotalLabel(item) }}</dd>
                    </div>
                  </dl>

                  <div class="mt-4 flex flex-wrap items-center gap-2">
                    <span class="mr-1 text-sm font-medium text-gray-700">
                      Quantity
                    </span>
                    <button
                      type="button"
                      class="flex h-11 w-11 items-center justify-center rounded-md border text-lg transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isItemPending(item.item_id) || access !== 'ready'"
                      :aria-label="`Decrease ${item.name} quantity`"
                      @click="changeQuantity(item, -1)"
                    >
                      <Icon name="heroicons:minus" class="h-4 w-4" />
                    </button>
                    <input
                      :value="item.quantity"
                      type="number"
                      min="1"
                      max="999"
                      inputmode="numeric"
                      class="h-11 w-16 rounded-md border text-center"
                      :disabled="isItemPending(item.item_id) || access !== 'ready'"
                      :aria-label="`${item.name} quantity`"
                      @change="handleQuantityInput(item, $event)"
                    />
                    <button
                      type="button"
                      class="flex h-11 w-11 items-center justify-center rounded-md border text-lg transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isItemPending(item.item_id) || access !== 'ready' || item.quantity >= 999"
                      :aria-label="`Increase ${item.name} quantity`"
                      @click="changeQuantity(item, 1)"
                    >
                      <Icon name="heroicons:plus" class="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div class="flex w-full flex-col items-end sm:w-auto sm:shrink-0">
                <p class="mb-2 text-lg font-semibold">
                  {{ lineTotalLabel(item) }}
                </p>
                <button
                  type="button"
                  class="text-sm font-semibold text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="isItemPending(item.item_id) || access !== 'ready'"
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
          <div class="mb-4">
            <p class="font-semibold text-gray-900">Workshop fitting only</p>
            <p class="mt-1 text-sm text-gray-600">
              All Phoenix Vanz products are completed and fitted at our workshop
              in Accrington. Delivery is not available.
            </p>
          </div>
          <div
            class="mt-4 flex justify-between border-t pt-4 text-xl font-bold text-gray-800"
          >
            <span>Total</span>
            <span>{{ cartTotalLabel }}</span>
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

    <div v-else-if="access === 'ready'" class="py-16 text-center">
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
