import { ref, onMounted } from "vue";
import { loadStripe } from "@stripe/stripe-js";

let stripePromise;

export const useStripe = () => {
  const stripe = ref(null);
  const config = useRuntimeConfig();

  if (!stripePromise) {
    stripePromise = loadStripe((config.public.stripePublishableKey || config.public.stripePk));
  }

  onMounted(async () => {
    stripe.value = await stripePromise;
  });

  return {
    stripe,
  };
};