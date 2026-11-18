<template>
  <div class="mx-auto max-w-3xl px-4 py-8 pt-28">
    <h1 class="mb-4 text-3xl font-bold">Order confirmation</h1>

    <p v-if="state === 'loading'" class="text-gray-700" role="status">Loading your order…</p>

    <template v-else>
      <p
        v-if="basketWarning && state === 'success'"
        class="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
        role="status"
      >
        Your order was saved, but the basket could not be refreshed. Review your basket before starting another order.
        <NuxtLink to="/cart" class="ml-1 font-semibold underline">Review your basket</NuxtLink>
      </p>

    <div v-if="state === 'success' && order" class="space-y-6 rounded-lg bg-white p-6 shadow-md">
      <p class="text-lg">Your order has been received. No payment has been taken.</p>
      <p>Your order is awaiting a deposit and confirmation of fitting arrangements.</p>
      <p>Reference: <strong>{{ order.reference }}</strong></p>

      <section>
        <h2 class="mb-3 text-xl font-semibold">Saved products</h2>
        <ul class="divide-y">
          <li v-for="(item, index) in order.items" :key="`${item.product_name}-${index}`" class="py-4">
            <h3 class="font-semibold">{{ item.product_name }}</h3>
            <ul v-if="item.options.length" class="mt-2 space-y-1 text-sm text-gray-700">
              <li v-for="option in item.options" :key="`${option.group_name}-${option.option_name}`">
                {{ option.group_name }}: {{ option.option_name }}
                ({{ option.price_adjustment === "0.00" ? "Included" : `+£${option.price_adjustment}` }})
              </li>
            </ul>
            <dl class="mt-3 space-y-1 text-sm">
              <div class="flex justify-between gap-3">
                <dt>Quantity</dt>
                <dd>{{ item.quantity }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt>Configured unit price</dt>
                <dd>£{{ item.configured_unit_price }}</dd>
              </div>
              <div class="flex justify-between gap-3 font-semibold">
                <dt>Line total</dt>
                <dd>£{{ item.line_total }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="mb-3 text-xl font-semibold">Customer and vehicle</h2>
        <dl class="space-y-1 text-sm">
          <div class="flex justify-between gap-3"><dt>Name</dt><dd>{{ order.customer_name }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Email</dt><dd>{{ order.customer_email }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Phone</dt><dd>{{ order.customer_phone }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Make</dt><dd>{{ order.vehicle_make }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Model</dt><dd>{{ order.vehicle_model }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Year</dt><dd>{{ order.vehicle_year }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Wheelbase</dt><dd>{{ order.vehicle_wheelbase }}</dd></div>
          <div v-if="order.vehicle_registration" class="flex justify-between gap-3">
            <dt>Registration</dt><dd>{{ order.vehicle_registration }}</dd>
          </div>
          <div v-if="order.customer_notes" class="flex justify-between gap-3">
            <dt>Notes</dt><dd>{{ order.customer_notes }}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 class="mb-3 text-xl font-semibold">Payment</h2>
        <dl class="space-y-1">
          <div class="flex justify-between gap-3"><dt>Full total</dt><dd>£{{ order.full_total }}</dd></div>
          <div class="flex justify-between gap-3"><dt>Deposit required</dt><dd>£{{ order.deposit_required }}</dd></div>
          <div class="flex justify-between gap-3">
            <dt>Balance after the deposit</dt>
            <dd>£{{ order.balance_on_completion }}</dd>
          </div>
          <div class="flex justify-between gap-3 font-semibold"><dt>Payment</dt><dd>Unpaid</dd></div>
        </dl>
        <p class="mt-3 text-sm text-gray-700">
          The full total is unpaid. The balance after the deposit is not an amount due now.
        </p>
      </section>
    </div>

    <div v-else-if="state === 'unavailable'" class="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <h2 class="text-lg font-semibold">This order is not available</h2>
      <p class="mt-2">{{ message }}</p>
      <NuxtLink to="/contact" class="mt-4 inline-flex rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black">
        Contact Phoenix Vanz
      </NuxtLink>
    </div>

    <div v-else class="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <h2 class="text-lg font-semibold">The order could not be confirmed</h2>
      <p class="mt-2">{{ message }}</p>
      <button
        type="button"
        class="mt-4 rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black"
        @click="load"
      >
        Try again
      </button>
    </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { ORDER_MESSAGES } from "~/utils/orderClient";

useHead({
  title: "Order confirmation | Phoenix Vanz",
  meta: [
    {
      name: "description",
      content: "View an unpaid Phoenix Vanz order confirmation. No payment is taken on this page.",
    },
  ],
});

const route = useRoute();
const orders = useOrderSubmission();
const history = useOrderHistory();
const reference = computed(() => String(route.query.reference || ""));
const basketWarning = computed(() => orders.status().basketWarning);
const state = ref("loading");
const message = ref("");
const order = ref(null);

async function load() {
  order.value = null;
  if (!reference.value) {
    state.value = "unavailable";
    message.value = "This order is not available.";
    return;
  }
  state.value = "loading";
  message.value = "";
  const result = await history.readConfirmation(reference.value);
  if (result.stale || result.outcome !== "success") {
    order.value = null;
  }
  if (result.stale) {
    message.value = ORDER_MESSAGES.unavailable;
    state.value = "unavailable";
    return;
  }
  if (result.outcome === "success") {
    order.value = result.order;
    state.value = "success";
    return;
  }
  message.value = result.message;
  state.value = result.outcome === "unavailable" ? "unavailable" : "service";
}

onMounted(load);
watch(reference, load);
</script>
