<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { asArray } from "~/utils/apiData";

const config = useRuntimeConfig();
const siteRoot = `${String(config.public.siteUrl || "").replace(/\/+$/, "")}/`;
const pageTitle = "Campervan roof racks and ladders";
const fullTitle = `${pageTitle} | Phoenix Vanz`;
const pageDescription =
  "Bespoke campervan roof racks, ladders, carriers and fabrication, designed and fitted by Phoenix Vanz in Lancashire.";

useHead({
  title: pageTitle,
  titleTemplate: (titleChunk) =>
    titleChunk ? `${titleChunk} | Phoenix Vanz` : "Phoenix Vanz",
  meta: [
    { name: "description", content: pageDescription },
    { property: "og:type", content: "website" },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: pageDescription },
    { property: "og:url", content: siteRoot },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: pageDescription },
  ],
  link: [{ rel: "canonical", href: siteRoot }],
});

const fallbackSlides = ref([]);
let fallbackSlidesPromise = null;

const loadFallbackSlides = async () => {
  if (fallbackSlides.value.length) return;

  if (!fallbackSlidesPromise) {
    fallbackSlidesPromise = Promise.all([
      import("~/assets/images/home/crafter-beach.jpg"),
      import("~/assets/images/home/crafter-bike.jpg"),
      import("~/assets/images/home/sidebar.jpg"),
    ]).then(([beach, bike, sidebar]) => [
      {
        id: "fallback-beach",
        title: "Phoenix Vanz",
        subtitle: "Bespoke fabrication for your van",
        image: beach.default,
        mobile_image: null,
        button_text: "Explore our products",
        button_url: "#products",
      },
      {
        id: "fallback-bike",
        title: "Built for work and adventure",
        subtitle:
          "Campervan accessories designed and fitted in Lancashire",
        image: bike.default,
        mobile_image: null,
        button_text: "Shop by product",
        button_url: "#products",
      },
      {
        id: "fallback-sidebar",
        title: "Made around your van",
        subtitle:
          "Roof racks, ladders, carriers and bespoke fabrication",
        image: sidebar.default,
        mobile_image: null,
        button_text: "Contact Phoenix Vanz",
        button_url: "/contact",
      },
    ]);
  }

  fallbackSlides.value = await fallbackSlidesPromise;
};

const { data: slidePayload } = await useFetch("/api/slides", {
  key: "home-slides",
  default: () => [],
});

const remoteSlides = computed(() =>
  asArray(slidePayload.value, ["slides"]).filter((slide) => slide?.image),
);

if (!remoteSlides.value.length) {
  await loadFallbackSlides();
}

const slides = computed(() =>
  remoteSlides.value.length
    ? remoteSlides.value
    : fallbackSlides.value,
);


const currentIndex = ref(0);
const prefersReducedMotion = ref(false);
const isUserPaused = ref(false);
const isHoverPaused = ref(false);
const isFocusPaused = ref(false);
let motionPreference = null;

const currentSlide = computed(() => {
  const availableSlides = Array.isArray(slides.value)
    ? slides.value
    : [];

  if (!availableSlides.length) {
    return null;
  }

  return (
    availableSlides[currentIndex.value]
    ?? availableSlides[0]
    ?? null
  );
});

let intervalId = null;

const stopAutoplay = () => {
  if (intervalId && import.meta.client) window.clearInterval(intervalId);
  intervalId = null;
};

const startAutoplay = () => {
  if (!import.meta.client) return;
  stopAutoplay();
  if (
    slides.value.length < 2
    || prefersReducedMotion.value
    || isUserPaused.value
    || isHoverPaused.value
    || isFocusPaused.value
  ) {
    return;
  }

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

const pauseForHover = () => {
  isHoverPaused.value = true;
  stopAutoplay();
};

const resumeAfterHover = () => {
  isHoverPaused.value = false;
  startAutoplay();
};

const pauseForFocus = () => {
  isFocusPaused.value = true;
  stopAutoplay();
};

const handleFocusOut = (event) => {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  isFocusPaused.value = false;
  startAutoplay();
};

const toggleAutoplay = () => {
  if (prefersReducedMotion.value) return;

  isUserPaused.value = !isUserPaused.value;
  if (isUserPaused.value) {
    stopAutoplay();
  } else {
    startAutoplay();
  }
};

const updateMotionPreference = (event) => {
  prefersReducedMotion.value = event.matches;
  if (event.matches) {
    stopAutoplay();
  } else if (!isUserPaused.value) {
    startAutoplay();
  }
};

watch(
  () => slides.value.length,
  () => {
    currentIndex.value = 0;
    startAutoplay();
  },
);

onMounted(() => {
  motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion.value = motionPreference.matches;
  motionPreference.addEventListener("change", updateMotionPreference);
  startAutoplay();
});

onUnmounted(() => {
  stopAutoplay();
  motionPreference?.removeEventListener("change", updateMotionPreference);
});
</script>

<template>
  <section
    class="relative flex min-h-[calc(100vh-5rem)] items-center justify-center overflow-hidden bg-black"
    aria-roledescription="carousel"
    aria-label="Phoenix Vanz highlights"
    @mouseenter="pauseForHover"
    @mouseleave="resumeAfterHover"
    @focusin="pauseForFocus"
    @focusout="handleFocusOut"

  >
    <h1 class="sr-only">Bespoke campervan roof racks and ladders</h1>

    <Transition name="hero-image">
      <div
        v-if="currentSlide?.image"
        :key="
          currentSlide?.id
          || currentSlide?.image
          || currentIndex
        "
        class="absolute inset-0"
      >
        <picture class="block h-full w-full">
          <source
            v-if="currentSlide?.mobile_image"
            media="(max-width: 767px)"
            :srcset="currentSlide?.mobile_image"
          />

          <img
            :src="currentSlide?.image"
            alt=""
            class="h-full w-full object-cover"
            loading="eager"
            :fetchpriority="
              currentIndex === 0 ? 'high' : 'auto'
            "
            decoding="async"
          />
        </picture>
      </div>
    </Transition>

    <div
      class="absolute inset-0 bg-black/50"
      aria-hidden="true"
    ></div>
    <div class="absolute inset-0 bg-black/50" aria-hidden="true"></div>

    <div
      v-if="currentSlide"
      class="relative z-[1] mx-auto max-w-4xl px-6 text-center text-white"
    >
      <Transition name="hero-copy" mode="out-in">
        <div :key="currentSlide.id || currentIndex">
          <p
            class="text-4xl font-extrabold drop-shadow-lg sm:text-6xl lg:text-7xl"
          >
            {{ currentSlide.title || "Phoenix Vanz" }}
          </p>
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

      <div
        class="absolute bottom-3 z-[2] flex max-w-[calc(100%-7rem)] items-center gap-1 overflow-x-auto sm:bottom-6"
      >
        <div class="flex items-center" role="group" aria-label="Choose slide">
          <button
            v-for="(_slide, index) in slides"
            :key="`dot-${index}`"
            type="button"
            class="flex h-11 w-11 flex-none items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-white"
            :aria-label="`Show slide ${index + 1} of ${slides.length}`"
            :aria-current="currentIndex === index ? 'true' : undefined"
            @click="goToSlide(index)"
          >
            <span
              class="h-2.5 rounded-full transition-all"
              :class="
                currentIndex === index
                  ? 'w-8 bg-white'
                  : 'w-2.5 bg-white/60 hover:bg-white/80'
              "
              aria-hidden="true"
            ></span>
          </button>
        </div>

        <button
          type="button"
          class="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-70"
          :aria-label="
            prefersReducedMotion
              ? 'Autoplay disabled by reduced-motion preference'
              : isUserPaused
                ? 'Play slideshow'
                : 'Pause slideshow'
          "
          :aria-pressed="isUserPaused || prefersReducedMotion"
          :disabled="prefersReducedMotion"
          @click="toggleAutoplay"
        >
          <Icon
            :name="
              isUserPaused || prefersReducedMotion
                ? 'heroicons:play'
                : 'heroicons:pause'
            "
            class="h-5 w-5"
            aria-hidden="true"
          />
        </button>
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
.hero-image-enter-active,
.hero-image-leave-active {
  transition: opacity 500ms ease;
}

.hero-image-enter-from,
.hero-image-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .hero-copy-enter-active,
  .hero-copy-leave-active,
  .hero-image-enter-active,
  .hero-image-leave-active {
    transition: none;
  }
}
</style>
