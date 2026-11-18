<template>
  <div class="container mx-auto px-4 py-8 pt-28">
    <h1 class="mb-6 text-center text-3xl font-bold">Order details</h1>

    <div
      v-if="!orderSubmissionEnabled"
      class="mx-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950"
    >
      <h2 class="text-lg font-semibold">Online payment is temporarily unavailable</h2>
      <p class="mt-2">
        Phoenix Vanz will confirm the correct fitment, fitting date, lead time and
        payment details directly with you.
      </p>
      <NuxtLink
        to="/contact"
        class="mt-4 inline-flex rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black"
      >
        Contact Phoenix Vanz
      </NuxtLink>
    </div>

    <div v-else class="mx-auto flex max-w-5xl flex-col gap-8 lg:flex-row">
      <section class="rounded-lg bg-white p-6 shadow-md lg:w-2/3">
        <h2 class="mb-4 text-2xl font-bold">Your basket</h2>
        <CartSessionNotice
          class="mb-4"
          :access="access === 'loading' ? '' : access"
          :pending="pending"
          @action="recoverFromNotice"
        />
        <p v-if="basketNotice" class="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950" role="status">
          {{ basketNotice }}
        </p>
        <ul v-if="access === 'ready' && lines.length" class="divide-y">
          <li v-for="item in lines" :key="item.item_id" class="py-4">
            <h3 class="text-lg font-semibold">{{ item.name }}</h3>
            <ul v-if="selectedOptions(item).length" class="mt-3 space-y-2">
              <li
                v-for="option in selectedOptions(item)"
                :key="`${item.item_id}-${option.group_id}-${option.option_id}-${option.option_name}`"
                class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-gray-700"
              >
                <span class="min-w-0 break-words">{{ option.group_name }}: {{ option.option_name }}</span>
                <span class="shrink-0">{{ optionAdjustmentLabel(option.price_adjustment) }}</span>
              </li>
            </ul>
            <dl class="mt-4 space-y-1 text-sm text-gray-700">
              <div class="flex flex-wrap justify-between gap-x-3">
                <dt>Configured unit price</dt>
                <dd>{{ moneyLabel(item.configured_unit_price ?? item.price) }}</dd>
              </div>
              <div class="flex flex-wrap justify-between gap-x-3">
                <dt>Quantity</dt>
                <dd>{{ item.quantity }}</dd>
              </div>
              <div class="flex flex-wrap justify-between gap-x-3 font-semibold text-gray-900">
                <dt>Line total</dt>
                <dd>{{ moneyLabel(item.line_total) }}</dd>
              </div>
            </dl>
          </li>
        </ul>
        <p v-else-if="access === 'ready'" class="text-gray-600">Your basket is empty.</p>
        <div class="mt-4 border-t pt-4">
          <PurchaseTerms />
          <div class="mt-4 flex justify-between text-xl font-bold text-gray-800">
            <span>Total</span>
            <span>{{ moneyLabel(cartTotal) }}</span>
          </div>
        </div>
        <NuxtLink to="/cart" class="mt-4 inline-flex font-semibold text-blue-700 hover:underline">
          Back to basket
        </NuxtLink>
      </section>

      <section class="rounded-lg bg-white p-6 shadow-md lg:w-1/3">
        <h2 class="mb-2 text-2xl font-bold">Customer and vehicle</h2>
        <p class="mb-4 text-sm leading-relaxed text-gray-700">
          No payment will be taken. Phoenix Vanz will confirm fitment and fitting arrangements.
        </p>

        <p v-if="submitting" class="mb-4 text-sm font-semibold text-gray-800" role="status">
          Submitting unpaid order…
        </p>
        <p
          v-if="notice"
          class="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
        >
          {{ notice }}
        </p>
        <div v-if="attemptPhase === 'resolved'" class="mb-4 space-y-3 text-sm text-gray-800" role="status">
          <p>You have already submitted this order.</p>
          <p>Changes to your basket apply only to a new order.</p>
          <NuxtLink
            v-if="resolvedReference"
            :to="`/order-confirmation?reference=${encodeURIComponent(resolvedReference)}`"
            class="inline-flex font-semibold text-blue-700 hover:underline"
          >
            View submitted order
          </NuxtLink>
          <button
            v-if="lines.length"
            type="button"
            class="block rounded border border-gray-900 px-4 py-3 font-semibold"
            @click="requestDifferentOrder"
          >
            Start another order from this basket
          </button>
          <NuxtLink
            v-else-if="access === 'ready'"
            to="/"
            class="inline-flex font-semibold text-blue-700 hover:underline"
          >
            Continue shopping
          </NuxtLink>
        </div>

        <form class="space-y-4" novalidate @submit.prevent="submitOrder">
          <div v-for="field in textFields" :key="field.key">
            <label :for="field.key" class="mb-1 block font-medium">{{ field.label }}</label>
            <input
              :id="field.key"
              v-model="fields[field.key]"
              :type="field.type"
              :autocomplete="field.autocomplete"
              :inputmode="field.inputmode"
              :disabled="inputsLocked"
              class="w-full rounded border p-2 disabled:bg-gray-100"
              :aria-invalid="fieldErrors[field.key] ? 'true' : 'false'"
              :aria-describedby="fieldErrors[field.key] ? `${field.key}-error` : undefined"
            />
            <p
              v-if="fieldErrors[field.key]"
              :id="`${field.key}-error`"
              class="mt-1 text-sm text-red-700"
              role="alert"
            >
              {{ fieldErrors[field.key] }}
            </p>
          </div>

          <div>
            <label for="customer_notes" class="mb-1 block font-medium">Notes (optional)</label>
            <textarea
              id="customer_notes"
              v-model="fields.customer_notes"
              rows="3"
              :disabled="inputsLocked"
              class="w-full rounded border p-2 disabled:bg-gray-100"
              :aria-invalid="fieldErrors.customer_notes ? 'true' : 'false'"
              :aria-describedby="fieldErrors.customer_notes ? 'customer_notes-error' : undefined"
            />
            <p
              v-if="fieldErrors.customer_notes"
              id="customer_notes-error"
              class="mt-1 text-sm text-red-700"
              role="alert"
            >
              {{ fieldErrors.customer_notes }}
            </p>
          </div>

          <button
            type="submit"
            class="w-full rounded bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="submitDisabled"
          >
            {{ submitting ? "Submitting unpaid order…" : "Submit unpaid order" }}
          </button>
        </form>

        <button
          v-if="attemptPhase === 'uncertain'"
          type="button"
          class="mt-3 w-full rounded border border-gray-900 px-4 py-3 font-semibold disabled:opacity-50"
          :disabled="submitting"
          @click="retryOrder"
        >
          Retry the same order request
        </button>
        <NuxtLink
          v-if="attemptPhase === 'blocked' || attemptPhase === 'conflict'"
          to="/contact"
          class="mt-4 inline-flex font-semibold text-blue-700 hover:underline"
        >
          Contact Phoenix Vanz
        </NuxtLink>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { logCartFailure } from "~/utils/cartClient";
import { BASKET_BLOCK_MESSAGES, basketSubmissionBlock } from "~/utils/orderClient";

useHead({
  title: "Order details | Phoenix Vanz",
  meta: [
    {
      name: "description",
      content: "Review your Phoenix Vanz basket and send unpaid order details. No payment is taken.",
    },
  ],
});

const router = useRouter();
const config = useRuntimeConfig();
const orderSubmissionEnabled = computed(() =>
  config.public.orderSubmissionEnabled === true ||
  String(config.public.orderSubmissionEnabled).toLowerCase() === "true",
);

const {
  access,
  pending,
  cart,
  cartTotal,
  loadCart,
  recoverBasket,
} = useCart();
const orders = useOrderSubmission();

const fields = reactive({
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_year: "",
  vehicle_wheelbase: "",
  vehicle_registration: "",
  customer_notes: "",
});
const fieldErrors = ref({});
const notice = ref("");
const submitting = ref(false);
const attemptPhase = ref("idle");
const resolvedReference = ref("");

const textFields = [
  { key: "customer_name", label: "Full name", type: "text", autocomplete: "name" },
  { key: "customer_email", label: "Email", type: "email", autocomplete: "email" },
  { key: "customer_phone", label: "Phone", type: "tel", autocomplete: "tel" },
  { key: "vehicle_make", label: "Vehicle make", type: "text", autocomplete: "off" },
  { key: "vehicle_model", label: "Vehicle model", type: "text", autocomplete: "off" },
  { key: "vehicle_year", label: "Vehicle year", type: "text", autocomplete: "off", inputmode: "numeric" },
  { key: "vehicle_wheelbase", label: "Wheelbase", type: "text", autocomplete: "off" },
  { key: "vehicle_registration", label: "Vehicle registration (optional)", type: "text", autocomplete: "off" },
];

const lines = computed(() => (access.value === "ready" ? cart.value?.items || [] : []));
const basketCode = computed(() => basketSubmissionBlock({
  cart: cart.value,
  access: access.value,
  pending: pending.value,
}));
const basketNotice = computed(() => (basketCode.value ? BASKET_BLOCK_MESSAGES[basketCode.value] : ""));
const inputsLocked = computed(() =>
  submitting.value
  || attemptPhase.value === "uncertain"
  || attemptPhase.value === "conflict"
  || attemptPhase.value === "blocked"
  || attemptPhase.value === "resolved",
);
const submitDisabled = computed(() =>
  submitting.value
  || Boolean(basketCode.value)
  || attemptPhase.value === "uncertain"
  || attemptPhase.value === "blocked"
  || attemptPhase.value === "conflict"
  || attemptPhase.value === "resolved",
);

const syncAttempt = () => {
  const current = orders.status();
  attemptPhase.value = current.phase;
  resolvedReference.value = current.reference || "";
};

const applyResult = async (result) => {
  syncAttempt();
  if (!result || result.outcome === "duplicate") return;
  if (result.outcome === "success") {
    await router.push({ path: "/order-confirmation", query: { reference: result.order.reference } });
    return;
  }
  notice.value = result.message || "";
  if (result.field) fieldErrors.value = { [result.field]: result.message };
};

const submitOrder = async () => {
  if (submitDisabled.value) return;
  notice.value = "";
  fieldErrors.value = {};
  submitting.value = true;
  try {
    await applyResult(await orders.submit(fields));
  } finally {
    submitting.value = false;
    syncAttempt();
  }
};

const retryOrder = async () => {
  if (submitting.value || attemptPhase.value !== "uncertain") return;
  notice.value = "";
  submitting.value = true;
  try {
    await applyResult(await orders.retry());
  } finally {
    submitting.value = false;
    syncAttempt();
  }
};

const requestDifferentOrder = () => {
  if (!orders.startNewOrder()) return;
  notice.value = "";
  syncAttempt();
};

const recoverFromNotice = async () => {
  try {
    await recoverBasket();
  } catch (error) {
    logCartFailure("cart-refresh", error);
    notice.value = error?.customerMessage || "The basket could not be confirmed.";
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

const selectedOptions = (item) => (Array.isArray(item?.selected_options) ? item.selected_options : []);

onMounted(async () => {
  syncAttempt();
  if (!orderSubmissionEnabled.value) return;
  try {
    await loadCart();
  } catch (error) {
    logCartFailure("cart-read", error);
  }
});
</script>
