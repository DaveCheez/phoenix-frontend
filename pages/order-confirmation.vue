<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";

import {
  confirmationRecord,
  formatPounds,
  isOrderReference,
  paymentExplanation,
  publicOrderView,
} from "~/utils/orderConfirmation";

useHead({
  title: "Order confirmation | Phoenix Vanz",
  meta: [
    {
      name: "description",
      content: "View an unpaid Phoenix Vanz order confirmation. Online payment is not taken on this page.",
    },
  ],
});

const route = useRoute();
const router = useRouter();
const reference = computed(() => String(route.query.reference || "").trim());
const lookup = ref("");
const state = ref("empty");
const order = ref(null);
const copyMessage = ref("");
const heading = ref(null);

const payment = computed(() => paymentExplanation(order.value?.paymentStatus));

async function loadConfirmation() {
  copyMessage.value = "";
  const requested = reference.value;
  if (!requested) {
    state.value = "empty";
    order.value = null;
    return;
  }
  if (!isOrderReference(requested)) {
    state.value = "unavailable";
    order.value = null;
    return;
  }
  state.value = "loading";
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(requested)}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) {
      state.value = "needs-basket";
      order.value = null;
      return;
    }
    if (response.status === 404) {
      state.value = "unavailable";
      order.value = null;
      return;
    }
    if (!response.ok) {
      state.value = "failed";
      order.value = null;
      return;
    }
    const payload = await response.json();
    const view = publicOrderView(payload?.order);
    if (!view || view.reference !== requested) {
      state.value = "failed";
      order.value = null;
      return;
    }
    order.value = view;
    state.value = "ready";
    await nextTick();
    heading.value?.focus();
  } catch {
    state.value = "failed";
    order.value = null;
  }
}

onMounted(() => {
  watch(reference, loadConfirmation, { immediate: true });
});

function openReference() {
  const requested = lookup.value.trim();
  lookup.value = "";
  if (!isOrderReference(requested)) {
    state.value = "unavailable";
    order.value = null;
    router.replace({ path: "/order-confirmation" });
    return;
  }
  router.replace({ path: "/order-confirmation", query: { reference: requested } });
}

async function copyReference() {
  if (!order.value) return;
  try {
    await navigator.clipboard.writeText(order.value.reference);
    copyMessage.value = "Order reference copied.";
  } catch {
    copyMessage.value = "Select the order reference and copy it.";
  }
}

function saveReference() {
  if (!order.value) return;
  const file = new Blob([confirmationRecord(order.value)], { type: "text/plain" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `phoenix-vanz-${order.value.reference}.txt`;
  link.click();
  URL.revokeObjectURL(url);
  copyMessage.value = "Order reference saved.";
}
</script>

<template>
  <div class="mx-auto max-w-xl p-6">
    <h1 ref="heading" tabindex="-1" class="mb-4 text-2xl font-bold text-gray-950 outline-none">
      {{ state === "ready" ? "Order received" : "Order confirmation" }}
    </h1>

    <form class="mb-6 space-y-3" @submit.prevent="openReference">
      <label for="order-lookup" class="block font-semibold text-gray-950">Open an order reference</label>
      <div class="flex flex-col gap-3 sm:flex-row">
        <input
          id="order-lookup"
          v-model="lookup"
          maxlength="32"
          autocomplete="off"
          spellcheck="false"
          class="min-h-11 w-full rounded border px-3"
          placeholder="PV- reference"
        />
        <button type="submit" class="min-h-11 rounded bg-gray-900 px-4 font-semibold text-white">
          Open order
        </button>
      </div>
    </form>

    <p v-if="state === 'loading'" role="status" class="text-gray-800">Loading the order.</p>

    <p v-else-if="state === 'empty'" class="text-gray-800">
      Enter the Phoenix Vanz order reference from this browser's basket. The reference alone does not open an order.
    </p>

    <p v-else-if="state === 'unavailable'" role="alert" class="rounded border border-gray-300 bg-gray-50 p-4 text-gray-950">
      This order is not available.
    </p>

    <p v-else-if="state === 'needs-basket'" role="alert" class="rounded border border-amber-300 bg-amber-50 p-4 text-amber-950">
      Start a basket in this browser before opening an order. The reference alone does not open it.
    </p>

    <p v-else-if="state === 'failed'" role="alert" class="rounded border border-gray-300 bg-gray-50 p-4 text-gray-950">
      The order could not be loaded. Refresh this page to try the same reference again. That does not create another order.
    </p>

    <article v-else-if="state === 'ready' && order" class="space-y-6 text-gray-950">
      <p class="text-sm font-semibold uppercase tracking-wide text-gray-700">Phoenix Vanz order reference</p>
      <p id="order-reference" class="break-all text-3xl font-bold">{{ order.reference }}</p>
      <p v-if="order.createdOn">Created {{ order.createdOn }}</p>
      <div class="flex flex-col gap-3 sm:flex-row">
        <button type="button" class="min-h-11 rounded bg-gray-900 px-4 font-semibold text-white" @click="copyReference">
          Copy reference
        </button>
        <button type="button" class="min-h-11 rounded border border-gray-900 px-4 font-semibold" @click="saveReference">
          Save reference
        </button>
      </div>
      <p role="status" class="min-h-6 text-sm">{{ copyMessage }}</p>

      <section class="rounded border border-amber-300 bg-amber-50 p-4" aria-labelledby="payment-state">
        <h2 id="payment-state" class="text-lg font-semibold">{{ payment.heading }}</h2>
        <p class="mt-2">{{ payment.detail }}</p>
      </section>

      <section aria-labelledby="ordered-products">
        <h2 id="ordered-products" class="mb-3 text-lg font-semibold">Ordered products</h2>
        <ul class="space-y-4">
          <li v-for="(item, index) in order.items" :key="index" class="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:justify-between">
            <div>
              <p class="font-semibold">{{ item.productName }}</p>
              <p>Quantity {{ item.quantity }}</p>
              <p v-for="(option, optionIndex) in item.options" :key="optionIndex">
                {{ option.groupName }}: {{ option.optionName }} ({{ formatPounds(option.priceAdjustment) }})
              </p>
            </div>
            <p class="font-semibold sm:text-right">
              {{ formatPounds(item.configuredUnitPrice) }} each<br />
              {{ formatPounds(item.lineTotal) }} line
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="order-total">
        <h2 id="order-total" class="text-lg font-semibold">Order total {{ formatPounds(order.fullTotal) }}</h2>
        <p class="mt-2">Deposit required later {{ formatPounds(order.depositRequired) }}. Not taken.</p>
        <p>Balance on completion {{ formatPounds(order.balanceOnCompletion) }}.</p>
        <p>Fitting charge {{ formatPounds(order.fittingCharge) }}.</p>
        <p v-if="order.depositTerms">{{ order.depositTerms }}</p>
      </section>

      <section aria-labelledby="submitted-details">
        <h2 id="submitted-details" class="text-lg font-semibold">Details submitted</h2>
        <p class="mt-2">{{ order.customerName }}</p>
        <p>{{ order.vehicle }}</p>
      </section>

      <PurchaseTerms />
    </article>

    <p class="mt-8">
      <NuxtLink to="/" class="font-semibold text-blue-800 underline">Return to home</NuxtLink>
    </p>
  </div>
</template>
