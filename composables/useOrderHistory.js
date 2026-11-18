import { computed, reactive, watch } from "vue";
import { createOrderHistory, orderHistoryLost } from "~/utils/orderClient";

const state = reactive({ phase: "unknown" });

let history;
let watching = false;

async function nuxtFetch(path, options = {}) {
  const response = await $fetch.raw(path, options);
  return { status: response.status, _data: response._data };
}

export function useOrderHistory() {
  if (!history) history = createOrderHistory({ state, fetch: nuxtFetch });
  if (import.meta.client && !watching) {
    watching = true;
    const cart = useCart();
    watch(cart.access, (value) => {
      if (orderHistoryLost(value)) history.loseSession();
    });
  }
  return {
    showSavedOrders: computed(() => state.phase === "saved"),
    restore: () => history.read(1),
    read: (page, options) => history.read(page, options),
    readConfirmation: (reference) => history.readConfirmation(reference),
    noteSavedOrder: () => history.noteSavedOrder(),
  };
}
