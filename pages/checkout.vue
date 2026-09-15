<template>
  <div class="max-w-xl mx-auto p-6">
    <h1 class="text-2xl font-bold mb-4">Checkout</h1>

    <div v-if="step === 1">
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
import { nextTick, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const config = useRuntimeConfig();
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
  const publishableKey = config.public.stripePk;
  if (!publishableKey) {
    throw new Error("Stripe is not configured for this deployment.");
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
