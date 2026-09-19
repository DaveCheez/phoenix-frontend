<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import logoUrl from "~/assets/images/logo.png";

const route = useRoute();
const slug = computed(() => String(route.params.slug || ""));

const {
  data: category,
  error,
  status,
  refresh,
} = await useFetch(() => `/api/category/${encodeURIComponent(slug.value)}`, {
  key: `category-${slug.value}`,
  default: () => null,
});

const products = computed(() =>
  Array.isArray(category.value?.products) ? category.value.products : [],
);

useHead(() => ({
  title: category.value?.name || "Products",
  meta: category.value?.description
    ? [{ name: "description", content: category.value.description.slice(0, 155) }]
    : [],
}));
</script>

<template>
  <section class="min-h-screen bg-gray-100 text-black">
    <div
      v-if="category?.header_image"
      class="h-72 w-full overflow-hidden md:h-96"
    >
      <img
        :src="category.header_image"
        :alt="category.name"
        class="h-full w-full object-cover"
      />
    </div>

    <div class="container mx-auto max-w-5xl px-6 py-12 md:py-20">
      <div v-if="status === 'pending'" class="py-16 text-center">
        <Icon name="svg-spinners:ring-resize" class="mx-auto h-8 w-8" />
        <p class="mt-3 text-gray-600">Loading products…</p>
      </div>

      <div v-else-if="error || !category" class="py-16 text-center">
        <h1 class="text-3xl font-bold">Category unavailable</h1>
        <p class="mt-3 text-gray-600">
          We could not load this product category.
        </p>
        <button
          type="button"
          class="mt-6 rounded bg-gray-900 px-5 py-3 text-white"
          @click="refresh"
        >
          Try again
        </button>
      </div>

      <template v-else>
        <h1 class="mb-6 text-center text-4xl font-bold text-gray-800">
          {{ category.name }}
        </h1>

        <p v-if="category.description" class="mb-10 text-center text-gray-600">
          {{ category.description }}
        </p>

        <div v-if="products.length" class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <NuxtLink
            v-for="product in products"
            :key="product.id"
            :to="`/product/${product.slug}`"
            class="block rounded-lg bg-white p-4 shadow transition-transform hover:scale-[1.01]"
          >
            <div
              class="flex h-48 w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100"
            >
              <img
                :src="product.thumbnail || logoUrl"
                :alt="product.name"
                class="h-full w-full object-cover"
                loading="lazy"
              />
            </div>

            <h2 class="mt-3 text-xl font-semibold">{{ product.name }}</h2>
            <p class="mt-1 line-clamp-3 text-gray-600">
              {{ product.description }}
            </p>
            <p class="mt-3 text-lg font-bold">£{{ product.price }}</p>
          </NuxtLink>
        </div>

        <p v-else class="text-center text-gray-500">
          No products have been added to this category yet.
        </p>
      </template>
    </div>
  </section>
</template>
