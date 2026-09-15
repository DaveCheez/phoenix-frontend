<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const slug = route.params.slug;

const category = ref(null);
const products = ref([]);
const error = ref(null);

onMounted(async () => {
  try {
    const res = await $fetch(`/api/category/${slug}`);
    if (res.error) throw new Error(res.error);

    category.value = res;
    products.value = res.products;
  } catch (err) {
    error.value = err.message;
  }
});
</script>

<template>
  <section class="bg-gray-100 text-black">
    <!-- ✅ Full-Width Category Header Image -->
    <div
      v-if="category?.header_image"
      class="w-full h-72 md:h-96 overflow-hidden"
    >
      <img
        :src="category.header_image"
        :alt="category.name"
        class="w-full h-full object-cover"
      />
    </div>

    <!-- ✅ Category Content -->
    <div class="container mx-auto max-w-5xl px-6 py-12 md:py-20">
      <h1 class="text-4xl font-bold text-center text-gray-800 mb-6">
        {{ category?.name || "Loading..." }}
      </h1>

      <p v-if="category?.description" class="text-center text-gray-600 mb-10">
        {{ category.description }}
      </p>

      <p v-if="error" class="text-red-500 text-center">{{ error }}</p>

      <!-- Products Grid -->
      <div v-if="products.length" class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <NuxtLink
          v-for="product in products"
          :key="product.id"
          :to="`/product/${product.slug}`"
          class="block p-4 bg-white shadow rounded-lg transition-transform hover:scale-105"
        >
          <div
            class="w-full h-48 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center"
          >
            <img
              v-if="product.thumbnail"
              :src="product.thumbnail"
              :alt="product.name"
              class="object-cover w-full h-full"
            />
            <span v-else class="text-gray-500">{{ product.name }}</span>
          </div>

          <h2 class="text-xl font-semibold mt-2">{{ product.name }}</h2>
          <p class="text-gray-600">{{ product.description }}</p>
          <p class="text-lg font-bold mt-2">£{{ product.price }}</p>
        </NuxtLink>
      </div>

      <p v-else-if="!error" class="text-center text-gray-500">
        Loading products...
      </p>
    </div>
  </section>
</template>
