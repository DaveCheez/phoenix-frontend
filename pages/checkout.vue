<template>
  <div class="max-w-xl mx-auto p-6">
    <h1 class="text-2xl font-bold mb-4">Checkout</h1>

    <div v-if="!checkoutEnabled" class="space-y-6">
      <div class="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
        <h2 class="text-lg font-semibold">Online payment is temporarily unavailable</h2>
        <p class="mt-2">
          Phoenix Vanz will confirm the correct fitment, fitting date, lead time and
          payment details directly with you.
        </p>
        <NuxtLink
          to="/contact"
          class="mt-4 inline-flex min-h-11 items-center rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black"
        >
          Contact Phoenix Vanz
        </NuxtLink>
      </div>

      <form class="space-y-4" novalidate @submit.prevent="submitUnpaidOrder(false)">
        <h2 class="text-lg font-semibold">Place an unpaid order</h2>
        <p>
          Payment is not taken. The prices come from your basket on the server.
          A repeat of this submission uses the same order.
        </p>
        <p v-if="orderError" role="alert" class="rounded bg-red-50 p-3 text-red-800">{{ orderError }}</p>
        <div>
          <label for="customer-name" class="mb-1 block">Full name</label>
          <input id="customer-name" v-model="details.customer_name" autocomplete="name" maxlength="200" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="customer-email" class="mb-1 block">Email</label>
          <input id="customer-email" v-model="details.customer_email" type="email" autocomplete="email" maxlength="254" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="customer-phone" class="mb-1 block">Phone</label>
          <input id="customer-phone" v-model="details.customer_phone" type="tel" autocomplete="tel" maxlength="40" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="vehicle-make" class="mb-1 block">Vehicle make</label>
          <input id="vehicle-make" v-model="details.vehicle_make" maxlength="100" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="vehicle-model" class="mb-1 block">Vehicle model</label>
          <input id="vehicle-model" v-model="details.vehicle_model" maxlength="100" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="vehicle-year" class="mb-1 block">Vehicle year</label>
          <input id="vehicle-year" v-model="details.vehicle_year" inputmode="numeric" maxlength="4" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="vehicle-wheelbase" class="mb-1 block">Wheelbase</label>
          <input id="vehicle-wheelbase" v-model="details.vehicle_wheelbase" maxlength="50" required class="min-h-11 w-full rounded border p-2" />
        </div>
        <div>
          <label for="vehicle-registration" class="mb-1 block">Registration, if you want it on the order</label>
          <input id="vehicle-registration" v-model="details.vehicle_registration" maxlength="20" autocomplete="off" class="min-h-11 w-full rounded border p-2" />
        </div>
        <PurchaseTerms />
        <button
          type="submit"
          class="min-h-11 w-full rounded bg-gray-900 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
          :disabled="submitting"
        >
          {{ submitting ? "Submitting..." : "Create unpaid order" }}
        </button>
        <button
          v-if="offerSeparate"
          type="button"
          class="min-h-11 w-full rounded border border-gray-900 px-4 font-semibold sm:w-auto"
          :disabled="submitting"
          @click="submitUnpaidOrder(true)"
        >
          Submit as a separate order
        </button>
      </form>
    </div>

    <div v-else-if="step === 1">
      <form @submit.prevent="goToPayment" class="space-y-4">
        <div>
          <label class="block mb-1">Full Name</label>
          <input
            v-model="address.name"
            required
            class="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label class="block mb-1">Email</label>
          <input
            v-model="address.email"
            type="email"
            required
            class="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label class="block mb-1">Address</label>
          <input
            v-model="address.line1"
            required
            class="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label class="block mb-1">City</label>
          <input
            v-model="address.city"
            required
            class="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label class="block mb-1">Postcode</label>
          <input
            v-model="address.postcode"
            required
            class="w-full border p-2 rounded"
          />
        </div>

        <button
          type="submit"
          class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Continue to Payment
        </button>
      </form>
    </div>

    <div v-else-if="step === 2">
      <h2 class="text-xl font-semibold mb-4">Payment</h2>
      <p v-if="paymentError" class="mb-4 rounded bg-red-50 p-3 text-red-700">
        {{ paymentError }}
      </p>
      <div id="card-element" class="border p-4 rounded"></div>
      <button
        @click="pay"
        :disabled="isPaying || !!paymentError"
        class="mt-4 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ isPaying ? "Processing..." : "Pay" }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { createIdempotencyKey, submissionKey, validateCustomer } from "~/utils/orderConfirmation";

useHead({
  title: "Checkout | Phoenix Vanz",
  meta: [
    {
      name: "description",
      content:
        "Online checkout is temporarily unavailable. Contact Phoenix Vanz to order.",
    },
  ],
});

const router = useRouter();
const config = useRuntimeConfig();
const checkoutEnabled = computed(() =>
  config.public.checkoutEnabled === true ||
  String(config.public.checkoutEnabled).toLowerCase() === "true",
);
const step = ref(1);
const paymentError = ref("");
const isPaying = ref(false);
const address = ref({
  name: "",
  email: "",
  line1: "",
  city: "",
  postcode: "",
});
const details = ref({
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_year: "",
  vehicle_wheelbase: "",
  vehicle_registration: "",
});
const orderError = ref("");
const submitting = ref(false);
const offerSeparate = ref(false);

const submitUnpaidOrder = async (separate) => {
  if (checkoutEnabled.value || submitting.value) return;
  orderError.value = "";
  const validated = validateCustomer(details.value);
  if (!validated.ok) {
    orderError.value = validated.error;
    return;
  }
  const decision = submissionKey(window.sessionStorage, validated.body, {
    replace: separate === true,
    createKey: createIdempotencyKey,
  });
  if (decision.action === "conflict") {
    offerSeparate.value = true;
    orderError.value = "These details differ from the unpaid order already submitted in this browser. Open that confirmation, or submit a separate order.";
    return;
  }
  submitting.value = true;
  try {
    const csrfResponse = await fetch("/api/cart/csrf", {
      credentials: "same-origin",
      headers: { accept: "application/json", "x-phoenix-csrf-request": "1" },
    });
    const csrfBody = await csrfResponse.json().catch(() => null);
    if (!csrfResponse.ok || typeof csrfBody?.csrf_token !== "string") {
      orderError.value = "The order was not sent. Start a basket and try again.";
      return;
    }
    const response = await fetch("/api/orders", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-phoenix-csrf": csrfBody.csrf_token,
        "idempotency-key": decision.key,
      },
      body: JSON.stringify(validated.body),
    });
    const payload = await response.json().catch(() => null);
    const createdReference = payload?.order?.reference;
    if ((response.status === 201 || response.status === 200) && typeof createdReference === "string") {
      await router.push({ path: "/order-confirmation", query: { reference: createdReference } });
      return;
    }
    if (response.status === 409) {
      offerSeparate.value = true;
      orderError.value = "This submission does not match the unpaid order already stored. It was not created again.";
      return;
    }
    if (response.status === 401) {
      orderError.value = "Start a basket in this browser before placing an order.";
      return;
    }
    orderError.value = "The unpaid order could not be created. You can try again without creating a second order.";
  } catch {
    orderError.value = "The unpaid order could not be created. You can try again without creating a second order.";
  } finally {
    submitting.value = false;
  }
};

let stripe;
let elements;
let card;

const goToPayment = async () => {
  paymentError.value = "";
  step.value = 2;
  await nextTick();

  try {
    await loadStripe();
  } catch (error) {
    console.error("Stripe initialisation failed:", error);
    paymentError.value =
      error instanceof Error
        ? error.message
        : "Online checkout is not available.";
  }
};

const loadStripe = async () => {
  const publishableKey = String(
    config.public.stripePublishableKey || "",
  ).trim();

  if (!publishableKey) {
    throw new Error(
      "Stripe is not configured. Set NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.",
    );
  }

  if (!/^pk_(test|live)_/.test(publishableKey)) {
    throw new Error(
      "The Stripe browser key is invalid. Use a publishable key beginning pk_test_ or pk_live_ — never a secret key.",
    );
  }

  const stripeJs = await import("@stripe/stripe-js");
  stripe = await stripeJs.loadStripe(publishableKey);
  if (!stripe) {
    throw new Error("Stripe could not be initialised.");
  }

  elements = stripe.elements();
  card = elements.create("card");
  card.mount("#card-element");
};

const pay = async () => {
  if (!stripe || !card || isPaying.value) return;

  paymentError.value = "";
  isPaying.value = true;

  try {
    const { paymentMethod, error } = await stripe.createPaymentMethod({
      type: "card",
      card,
      billing_details: {
        name: address.value.name,
        email: address.value.email,
        address: {
          line1: address.value.line1,
          city: address.value.city,
          postal_code: address.value.postcode,
        },
      },
    });

    if (error) {
      paymentError.value = error.message || "Payment details are invalid.";
      return;
    }

    const response = await fetch("/api/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: address.value,
        paymentMethodId: paymentMethod.id,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("Order submission failed:", details);
      paymentError.value =
        "Online checkout is not available yet. Please contact Phoenix Vanz to order.";
      return;
    }

    await router.push("/order-confirmation");
  } catch (error) {
    console.error("Checkout failed:", error);
    paymentError.value =
      "Online checkout is not available. Please contact Phoenix Vanz to order.";
  } finally {
    isPaying.value = false;
  }
};
</script>
