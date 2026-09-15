<script setup>
import { ref, onMounted } from "vue";

const { cartItems, cartTotal, isCartLoading, loadCart, removeFromCart } = useCart();

onMounted(() => {
  loadCart();
});
</script>
<template>
  <div class="container mx-auto px-4 py-8 pt-28">
    <h1 class="text-3xl font-bold mb-6 text-center">Your Shopping Cart</h1>

    <div v-if="isCartLoading" class="text-center">
      <p>Loading your cart...</p>
    </div>

    <div
      v-else-if="cartItems.length > 0"
      class="flex flex-col lg:flex-row gap-8"
    >
      <!-- Cart Items -->
      <div class="lg:w-2/3">
        <div class="bg-white shadow-md rounded-lg p-6">
          <ul>
            <li
              v-for="item in cartItems"
              :key="item.item_id"

              class="flex flex-col sm:flex-row items-center sm:items-start justify-between py-6 border-b last:border-b-0"
            >
              <div class="flex items-start mb-4 sm:mb-0">
                <NuxtLink
                  :to="`/product/${item.product_slug}`"
                  class="flex-shrink-0"
                >
                  <img
                    :src="item.image"
                    :alt="item.name"
                    class="w-24 h-24 object-cover rounded-md mr-6 border"
                  />
                </NuxtLink>
                <div class="flex-grow">
                  <NuxtLink
                    :to="`/product/${item.product_slug}`"
                    class="hover:text-blue-600"
                  >
                    <h2 class="text-lg font-semibold">{{ item.name }}</h2>
                  </NuxtLink>
                  <p v-if="item.sku" class="text-sm text-gray-500 mt-1">
                    SKU: {{ item.sku }}
                  </p>
                  <p class="text-gray-700 mt-1">
                    £{{ Number(item.price).toFixed(2) }}
                  </p>
                  <p class="text-sm text-gray-500 mt-1">
                    Qty: {{ item.quantity }}
                  </p>
                </div>
              </div>

              <div class="flex flex-col items-end w-full sm:w-auto">
                <p class="text-lg font-semibold mb-2">
                  £{{ (item.price * item.quantity).toFixed(2) }}
                </p>
                <button
                  @click="removeFromCart(item.item_id)"
                  class="text-red-500 hover:text-red-700 font-semibold text-sm"
                >
                  Remove
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- Order Summary -->
      <div class="lg:w-1/3">
        <div class="bg-white shadow-md rounded-lg p-6">
          <h2 class="text-2xl font-bold mb-4">Order Summary</h2>
          <div class="flex justify-between mb-2">
            <span>Subtotal</span>
            <span>£{{ cartTotal }}</span>
          </div>
          <div class="flex justify-between mb-4">
            <span>Shipping</span>
            <span>TBD</span>
          </div>
          <div
            class="flex justify-between font-bold text-xl border-t pt-4 mt-4 text-gray-800"
          >
            <span>Total</span>
            <span>£{{ cartTotal }}</span>
          </div>
          <NuxtLink to="/checkout">
            <button
              class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold mt-6"
            >
              Proceed to Checkout
            </button>
          </NuxtLink>
        </div>
      </div>
    </div>

    <div v-else class="text-center">
      <p class="text-xl text-gray-600 mb-4">Your cart is empty.</p>
      <NuxtLink
        to="/"
        class="bg-gray-800 hover:bg-gray-900 text-white font-bold py-2 px-4 rounded"
      >
        Continue Shopping
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
/* Add any page-specific styles here */
.pt-28 {
  padding-top: 7rem; /* Adjust based on your navbar's height */
}
</style>
