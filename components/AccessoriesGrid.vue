<template>
  <section class="py-20 bg-black text-white">
    <div class="container mx-auto">
      <h2 class="text-3xl font-bold text-center mb-8">Products We Create</h2>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
        <NuxtLink
          v-for="(item, index) in accessories"
          :key="index"
          :to="`/shop/${item.slug}`"
          class="text-center hover:shadow-xl transition-all rounded-lg block"
        >
          <img
            :src="item.thumbnail_image || '/images/default.jpg'"
            :alt="item.name"
            class="w-full h-48 object-cover rounded-lg shadow-md"
          />
          <h3 class="mt-4 text-xl font-semibold">{{ item.name }}</h3>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from "vue";

const accessories = ref([]);

onMounted(async () => {
  try {
    const res = await $fetch("/api/accessories?type=product");
    accessories.value = res;
  } catch (error) {
    console.error("Failed to load accessories:", error);
  }
});
</script>
