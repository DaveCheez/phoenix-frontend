<script setup>
const route = useRoute();
const reference = computed(() => String(route.query.reference || ""));
</script>

<template>
  <div class="mx-auto max-w-xl p-6 pt-28 text-center">
    <template v-if="reference">
      <h1 class="mb-4 text-2xl font-bold">Order received</h1>
      <p class="mb-4 text-gray-600">
        Your reference is <strong>{{ reference }}</strong>. Phoenix Vanz will be
        in touch to confirm fitment, lead time and installation.
      </p>
    </template>

    <template v-else>
      <h1 class="mb-4 text-2xl font-bold">No confirmed online order</h1>
      <p class="mb-4 text-gray-600">
        Online checkout is not currently enabled. Please contact Phoenix Vanz
        and we will confirm the correct product and fitting details.
      </p>
      <NuxtLink
        to="/contact"
        class="inline-flex rounded bg-gray-900 px-5 py-3 font-semibold text-white"
      >
        Contact Phoenix Vanz
      </NuxtLink>
    </template>

    <div class="mt-6">
      <NuxtLink to="/" class="text-blue-700 hover:underline">
        Return to home
      </NuxtLink>
    </div>
  </div>
</template>
