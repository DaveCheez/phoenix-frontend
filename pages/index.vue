<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const fallbackSlides = [
  {
    id: "fallback-beach",
    title: "Phoenix Vanz",
    subtitle: "Bespoke fabrication for your van",
    image: "/images/home/crafter-beach.jpg",
    mobile_image: null,
    button_text: "Explore our products",
    button_url: "#products",
  },
  {
    id: "fallback-bike",
    title: "Built for work and adventure",
    subtitle: "Campervan accessories designed and fitted in Lancashire",
    image: "/images/home/crafter-bike.jpg",
    mobile_image: null,
    button_text: "Shop by product",
    button_url: "#products",
  },
  {
    id: "fallback-sidebar",
    title: "Made around your van",
    subtitle: "Roof racks, ladders, carriers and bespoke fabrication",
    image: "/images/home/sidebar.jpg",
    mobile_image: null,
    button_text: "Contact Phoenix Vanz",
    button_url: "/contact",
  },
];

const { data: remoteSlides } = await useFetch("/api/slides", {
  default: () => [],
});

const slides = computed(() =>
  Array.isArray(remoteSlides.value) && remoteSlides.value.length
    ? remoteSlides.value
    : fallbackSlides,
);
const currentIndex = ref(0);
const currentSlide = computed(() => slides.value[currentIndex.value] || slides.value[0]);
let intervalId = null;

const stopAutoplay = () => {
  if (intervalId) window.clearInterval(intervalId);
  intervalId = null;
};

const startAutoplay = () => {
  stopAutoplay();
  if (slides.value.length < 2) return;

  intervalId = window.setInterval(() => {
    currentIndex.value = (currentIndex.value + 1) % slides.value.length;
  }, 5000);
};

const goToSlide = (index) => {
  currentIndex.value = index;
  startAutoplay();
};

const previousSlide = () => {
  currentIndex.value =
    (currentIndex.value - 1 + slides.value.length) % slides.value.length;
  startAutoplay();
};

const nextSlide = () => {
  currentIndex.value = (currentIndex.value + 1) % slides.value.length;
  startAutoplay();
};

watch(
  () => slides.value.length,
  () => {
    currentIndex.value = 0;
    if (import.meta.client) startAutoplay();
  },
);

onMounted(startAutoplay);
onUnmounted(stopAutoplay);
</script>

<template>
  <section
    class="relative flex min-h-[calc(100vh-5rem)] items-center justify-center overflow-hidden bg-black"
    aria-roledescription="carousel"
    aria-label="Phoenix Vanz highlights"
    @mouseenter="stopAutoplay"
    @mouseleave="startAutoplay"
    @focusin="stopAutoplay"
    @focusout="startAutoplay"
  >
    <div
      v-for="(slide, index) in slides"
      :key="slide.id || slide.image || index"
      class="absolute inset-0 transition-opacity duration-1000"
      :class="currentIndex === index ? 'opacity-100' : 'pointer-events-none opacity-0'"
      :aria-hidden="currentIndex !== index"
    >
      <picture class="block h-full w-full">
        <source
          v-if="slide.mobile_image"
          media="(max-width: 767px)"
          :srcset="slide.mobile_image"
        />
        <img
          :src="slide.image"
          :alt="slide.title || 'Phoenix Vanz'"
          class="h-full w-full object-cover"
          :loading="index === 0 ? 'eager' : 'lazy'"
        />
      </picture>
    </div>

    <div class="absolute inset-0 bg-black/50" aria-hidden="true"></div>

    <div
      v-if="currentSlide"
      class="relative z-[1] mx-auto max-w-4xl px-6 text-center text-white"
    >
      <Transition name="hero-copy" mode="out-in">
        <div :key="currentSlide.id || currentIndex">
          <h1
            class="text-4xl font-extrabold drop-shadow-lg sm:text-6xl lg:text-7xl"
          >
            {{ currentSlide.title || "Phoenix Vanz" }}
          </h1>
          <p
            v-if="currentSlide.subtitle"
            class="mx-auto mt-5 max-w-3xl text-lg drop-shadow-lg sm:text-2xl"
          >
            {{ currentSlide.subtitle }}
          </p>

          <NuxtLink
            v-if="currentSlide.button_text && currentSlide.button_url?.startsWith('/')"
            :to="currentSlide.button_url"
            class="mt-8 inline-flex rounded-md bg-white px-6 py-3 font-semibold text-gray-900 shadow transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
          >
            {{ currentSlide.button_text }}
          </NuxtLink>
          <a
            v-else-if="currentSlide.button_text && currentSlide.button_url"
            :href="currentSlide.button_url"
            class="mt-8 inline-flex rounded-md bg-white px-6 py-3 font-semibold text-gray-900 shadow transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
          >
            {{ currentSlide.button_text }}
          </a>
        </div>
      </Transition>
    </div>

    <template v-if="slides.length > 1">
      <button
        type="button"
        class="absolute left-3 z-[2] flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white sm:left-6"
        aria-label="Previous slide"
        @click="previousSlide"
      >
        <Icon name="heroicons:chevron-left" class="h-6 w-6" />
      </button>
      <button
        type="button"
        class="absolute right-3 z-[2] flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white sm:right-6"
        aria-label="Next slide"
        @click="nextSlide"
      >
        <Icon name="heroicons:chevron-right" class="h-6 w-6" />
      </button>

      <div class="absolute bottom-6 z-[2] flex gap-2" role="tablist" aria-label="Choose slide">
        <button
          v-for="(_slide, index) in slides"
          :key="`dot-${index}`"
          type="button"
          class="h-2.5 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-white"
          :class="currentIndex === index ? 'w-8 bg-white' : 'w-2.5 bg-white/60 hover:bg-white/80'"
          :aria-label="`Show slide ${index + 1}`"
          :aria-selected="currentIndex === index"
          role="tab"
          @click="goToSlide(index)"
        ></button>
      </div>
    </template>
  </section>

  <div id="products">
    <AccessoriesGrid />
  </div>

  <section class="bg-black py-16 text-white">
    <div class="container mx-auto max-w-5xl px-6 text-center">
      <h2 class="mb-6 text-3xl font-bold text-white">
        Elevate Your Van with Phoenix Vanz
      </h2>
      <p class="text-lg leading-relaxed text-white">
        Looking for a rugged, custom-fit roof rack or ladder system for your VW
        Crafter, Mercedes Sprinter, or MAN TGE? At Phoenix Vanz, we specialise
        in bespoke, high-quality solutions designed for durability, safety and
        practical use. Whether your van is for work, weekends away or off-grid
        travel, our team builds each setup around the vehicle and the way you
        use it.
      </p>
    </div>
  </section>

  <CustomerReviews />
</template>

<style scoped>
.hero-copy-enter-active,
.hero-copy-leave-active {
  transition: opacity 250ms ease, transform 250ms ease;
}

.hero-copy-enter-from,
.hero-copy-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
