<script setup>
import { computed } from "vue";
import logoUrl from "~/assets/images/logo.png";
import { asArray } from "~/utils/apiData";

const {
  data: accessoryPayload,
  error,
  refresh,
  status,
} = await useFetch("/api/accessories", {
  key: "home-product-categories",
  query: { type: "product" },
  default: () => [],
});

const accessories = computed(() =>
  asArray(accessoryPayload.value, ["categories"]),
);
</script>

<template>
  <section class="bg-black py-20 text-white">
    <div class="container mx-auto px-6">
      <h2 class="mb-8 text-center text-3xl font-bold">Products We Create</h2>

      <div
        v-if="accessories.length"
        class="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5"
      >
        <NuxtLink
          v-for="item in accessories"
          :key="item.id || item.slug"
          :to="`/shop/${item.slug}`"
          class="block rounded-lg text-center transition-all hover:shadow-xl"
        >
          <img
            :src="item.thumbnail_image || logoUrl"
            :alt="item.name"
            class="h-48 w-full rounded-lg bg-white object-cover shadow-md"
            loading="lazy"
          />
          <h3 class="mt-4 text-xl font-semibold">{{ item.name }}</h3>
        </NuxtLink>
      </div>

      <p v-else-if="status === 'pending'" class="text-center text-gray-300">
        Loading products…
      </p>

      <div v-else-if="error" class="text-center">
        <p class="text-gray-300">Product categories are temporarily unavailable.</p>
        <button
          type="button"
          class="mt-4 rounded border border-white px-4 py-2 hover:bg-white hover:text-black"
          @click="refresh"
        >
          Try again
        </button>
      </div>

      <p v-else class="text-center text-gray-300">
        Product categories will appear here once added in Django admin.
      </p>
    </div>
  </section>
</template>
