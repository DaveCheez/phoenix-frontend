import { loadStripe } from "@stripe/stripe-js";
import { onMounted, ref } from "vue";

let stripePromise = null;

export const useStripe = () => {
  const stripe = ref(null);
  const error = ref("");
  const config = useRuntimeConfig();

  onMounted(async () => {
    const key = String(config.public.stripePublishableKey || "").trim();

    if (!/^pk_(test|live)_/.test(key)) {
      error.value =
        "Stripe is not configured with a valid browser publishable key.";
      return;
    }

    try {
      stripePromise ||= loadStripe(key);
      stripe.value = await stripePromise;
    } catch (stripeError) {
      console.error("Stripe initialisation failed:", stripeError);
      error.value = "Stripe could not be initialised.";
    }
  });

  return { stripe, error };
};
