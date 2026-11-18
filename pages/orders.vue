<template>
  <div class="mx-auto max-w-3xl px-4 py-8 pt-28">
    <h1 class="mb-3 text-3xl font-bold">Your orders</h1>
    <p class="mb-6 text-sm leading-relaxed text-gray-700">
      These orders are accessible using this browser's current guest session.
      They are not available as a permanent account or on another device.
    </p>

    <p v-if="state === 'loading'" class="text-gray-700" role="status">Loading your orders…</p>

    <div v-else-if="state === 'success' || state === 'empty'" class="space-y-4">
      <p v-if="state === 'empty'" class="rounded-lg bg-white p-6 text-gray-700 shadow-md">
        You have no submitted orders in this browser session.
      </p>
      <ul v-else class="divide-y rounded-lg bg-white px-6 shadow-md">
        <li v-for="order in orders" :key="order.reference" class="py-5">
          <h2 class="text-lg font-semibold">{{ order.reference }}</h2>
          <dl class="mt-3 space-y-1 text-sm">
            <div class="flex justify-between gap-3">
              <dt>Submitted</dt>
              <dd>{{ submittedLabel(order.created_at) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt>Total</dt>
              <dd>£{{ order.full_total }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt>Payment</dt>
              <dd>{{ paymentLabel(order.payment_status) }}</dd>
            </div>
          </dl>
          <NuxtLink
            :to="`/order-confirmation?reference=${encodeURIComponent(order.reference)}`"
            class="mt-3 inline-flex font-semibold text-blue-700 hover:underline"
          >
            View order
          </NuxtLink>
        </li>
      </ul>
      <div v-if="state === 'success'" class="flex items-center justify-between gap-3">
        <button
          type="button"
          class="rounded border border-gray-900 px-4 py-2 font-semibold disabled:opacity-40"
          :disabled="page <= 1"
          @click="load(page - 1)"
        >
          Previous
        </button>
        <p class="text-sm text-gray-700">Page {{ page }}</p>
        <button
          type="button"
          class="rounded border border-gray-900 px-4 py-2 font-semibold disabled:opacity-40"
          :disabled="!hasMore"
          @click="load(page + 1)"
        >
          Next
        </button>
      </div>
    </div>

    <div v-else-if="state === 'unavailable'" class="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <h2 class="text-lg font-semibold">Orders are not available</h2>
      <p class="mt-2">{{ message }}</p>
      <p class="mt-2 text-sm">Opening this page does not start a new guest session.</p>
    </div>

    <div v-else class="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <h2 class="text-lg font-semibold">Your orders could not be loaded</h2>
      <p class="mt-2">{{ message }}</p>
      <button
        type="button"
        class="mt-4 rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black"
        @click="load(page)"
      >
        Try again
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { formatSubmittedAt, ORDER_MESSAGES, paymentStatusLabel } from "~/utils/orderClient";

useHead({
  title: "Your orders | Phoenix Vanz",
  meta: [
    {
      name: "description",
      content: "View unpaid Phoenix Vanz orders saved for this browser's guest session. No payment is taken.",
    },
  ],
});

const history = useOrderHistory();
const { showSavedOrders } = history;
const state = ref("loading");
const message = ref("");
const orders = ref([]);
const page = ref(1);
const hasMore = ref(false);

const submittedLabel = (value) => formatSubmittedAt(value);
const paymentLabel = (value) => paymentStatusLabel(value);

function applyResult(result) {
  if (result.outcome === "success" || result.outcome === "empty") {
    page.value = result.list.page;
    hasMore.value = result.list.has_more;
    orders.value = result.list.orders;
    state.value = result.outcome;
    return;
  }
  orders.value = [];
  hasMore.value = false;
  message.value = result.message;
  state.value = result.outcome === "unavailable" ? "unavailable" : "service";
}

async function load(requestedPage, refresh = false) {
  orders.value = [];
  hasMore.value = false;
  state.value = "loading";
  message.value = "";
  let result = await history.read(requestedPage, { refresh });
  if (result.stale && showSavedOrders.value) {
    result = await history.read(requestedPage, { refresh: true });
  }
  if (result.stale) {
    orders.value = [];
    hasMore.value = false;
    if (showSavedOrders.value) {
      message.value = ORDER_MESSAGES.listService;
      state.value = "service";
      return;
    }
    message.value = ORDER_MESSAGES.listUnavailable;
    state.value = "unavailable";
    return;
  }
  applyResult(result);
}

onMounted(() => load(1));
</script>
