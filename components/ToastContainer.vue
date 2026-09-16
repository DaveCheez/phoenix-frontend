<script setup>
const { toasts, dismiss } = useToast();

const classesFor = (type) => {
  if (type === "success") return "border-green-600 bg-green-50 text-green-900";
  if (type === "error") return "border-red-600 bg-red-50 text-red-900";
  return "border-blue-600 bg-blue-50 text-blue-900";
};

const iconFor = (type) => {
  if (type === "success") return "heroicons:check-circle";
  if (type === "error") return "heroicons:exclamation-circle";
  return "heroicons:information-circle";
};
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed right-4 top-24 z-[120] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3"
      aria-live="polite"
      aria-atomic="true"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto flex items-start gap-3 rounded-lg border-l-4 p-4 shadow-lg"
          :class="classesFor(toast.type)"
          role="status"
        >
          <Icon :name="iconFor(toast.type)" class="mt-0.5 h-5 w-5 shrink-0" />
          <p class="min-w-0 flex-1 text-sm font-medium leading-5">
            {{ toast.message }}
          </p>
          <button
            type="button"
            class="rounded p-1 opacity-70 transition hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current"
            aria-label="Dismiss notification"
            @click="dismiss(toast.id)"
          >
            <Icon name="heroicons:x-mark" class="h-4 w-4" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
