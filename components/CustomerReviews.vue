<template>
  <section class="py-20 bg-black text-white">
    <div class="container mx-auto text-center">
  

      <div v-if="error" class="w-full max-w-4xl mx-auto">
        <!-- Please replace the `src` with your actual widget URL. -->
        <iframe
          src="https://3ac69229863844688cabee378f62fa34.elf.site"
          width="100%"
          height="780px"
          frameborder="0"
        ></iframe>
      </div>

      <div v-else class="relative overflow-hidden max-w-4xl mx-auto">
        <div
          class="flex transition-transform duration-700 ease-in-out"
          :style="{
            transform: `translateX(-${currentIndex * (100 / visibleCount)}%)`,
          }"
        >
          <div
            v-for="(review, index) in reviews"
            :key="index"
            class="w-full md:w-1/3 flex-shrink-0 px-4"
          >
            <div class="bg-white p-6 rounded-lg shadow-md">
              <div class="flex justify-center mb-2">
                <span
                  v-for="star in 5"
                  :key="star"
                  :class="
                    star <= review.stars ? 'text-yellow-500' : 'text-gray-300'
                  "
                  class="text-lg"
                  >★</span
                >
              </div>
              <h3 class="text-lg font-semibold text-gray-900">
                {{ review.name }}
              </h3>
              <p class="mt-2 text-gray-700">{{ review.content }}</p>
              <p class="mt-2 text-sm text-gray-500">
                Posted {{ review.time_ago }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";

const reviews = ref([]);
const error = ref(null);
const currentIndex = ref(0);
const visibleCount = 3; // Number of reviews visible at once on larger screens
let intervalId = null;

onMounted(async () => {
  try {
    const data = await $fetch("/api/google-reviews");
    reviews.value = data;

    if (reviews.value.length > visibleCount) {
      intervalId = setInterval(() => {
        currentIndex.value = (currentIndex.value + 1) % (reviews.value.length - visibleCount + 1);
      }, 5000); // Change review every 5 seconds
    }
  } catch (err) {
    error.value = "Could not load customer reviews at this time.";
    console.error(err);
  }
});

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
});
</script>
