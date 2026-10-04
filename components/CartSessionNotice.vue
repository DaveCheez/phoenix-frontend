<template>
  <section
    v-if="visible"
    class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
    aria-live="polite"
  >
    <p>{{ message }}</p>
    <p v-if="detail" class="mt-2">{{ detail }}</p>
    <div class="mt-4 flex flex-wrap gap-3">
      <button
        v-if="actionLabel"
        type="button"
        class="inline-flex min-h-11 items-center rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="pending"
        @click="$emit('action')"
      >
        {{ pending ? "Working…" : actionLabel }}
      </button>
      <NuxtLink
        v-if="showContact"
        to="/contact"
        class="inline-flex min-h-11 items-center rounded border border-gray-900 px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        Contact Phoenix Vanz
      </NuxtLink>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  access: { type: String, default: "loading" },
  pending: { type: Boolean, default: false },
});

defineEmits(["action"]);

const visible = computed(() =>
  ["legacy", "not_started", "missing_cart", "access_unavailable", "temporary", "locks_unavailable"].includes(props.access),
);

const message = computed(() => {
  if (props.access === "legacy" || props.access === "access_unavailable") {
    return "We cannot reopen your previous basket. Start a new empty basket to continue.";
  }
  if (props.access === "missing_cart") {
    return "Your basket is no longer available. You can open a new empty basket.";
  }
  if (props.access === "temporary") {
    return "We could not confirm the latest basket update. Check your basket before trying the change again.";
  }
  if (props.access === "locks_unavailable") {
    return "This browser cannot safely update the basket. Use a current browser, or contact Phoenix Vanz.";
  }
  if (props.access === "not_started") {
    return "Start an empty basket when you are ready to add a product.";
  }
  return "";
});

const detail = computed(() =>
  props.access === "legacy" || props.access === "access_unavailable"
    ? "Your previous basket will not be restored."
    : "",
);

const actionLabel = computed(() => {
  if (props.access === "legacy" || props.access === "access_unavailable" || props.access === "not_started") {
    return "Start a new basket";
  }
  if (props.access === "missing_cart") return "Open an empty basket";
  if (props.access === "temporary") return "Refresh basket";
  return "";
});

const showContact = computed(() => props.access === "locks_unavailable");
</script>
