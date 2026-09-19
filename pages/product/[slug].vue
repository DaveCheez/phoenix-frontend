<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/vue";
import "swiper/css";
import "swiper/css/navigation";

import ProductOptions from "@/components/ProductOptions.vue";
import logoUrl from "~/assets/images/logo.png";
import { errorText } from "~/utils/apiData";

const route = useRoute();
const slug = computed(() => String(route.params.slug || ""));

const {
  data: productPayload,
  error: productError,
  status,
  refresh,
} = await useFetch(() => `/api/products/${encodeURIComponent(slug.value)}`, {
  key: `product-${slug.value}`,
  default: () => null,
});

const product = computed(() => {
  const raw = productPayload.value;
  if (!raw || typeof raw !== "object" || raw.error) return null;

  const images = Array.isArray(raw.productimage_set)
    ? raw.productimage_set.map((item) => item?.image).filter(Boolean)
    : [];

  return {
    ...raw,
    images,
  };
});

const selectedImage = ref(null);
const selectedOptions = ref({});
const activeTab = ref("description");
const galleryOpen = ref(false);
const isAddingToCart = ref(false);

const { addToCart: addToCartComposable } = useCart();
const toast = useToast();

watch(
  () => product.value?.images,
  (images) => {
    selectedImage.value = Array.isArray(images) && images.length ? images[0] : null;
  },
  { immediate: true },
);

const handleKeydown = (event) => {
  if (!galleryOpen.value) return;
  if (event.key === "Escape") closeGallery();
  if (event.key === "ArrowRight") nextImage();
  if (event.key === "ArrowLeft") previousImage();
};

const openGallery = () => {
  if (!product.value?.images?.length || !import.meta.client) return;
  galleryOpen.value = true;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", handleKeydown);
};

const closeGallery = () => {
  galleryOpen.value = false;
  if (!import.meta.client) return;
  document.body.style.overflow = "";
  document.removeEventListener("keydown", handleKeydown);
};

const nextImage = () => {
  const images = product.value?.images || [];
  if (!images.length) return;
  const currentIndex = images.indexOf(selectedImage.value || images[0]);
  selectedImage.value = images[(currentIndex + 1) % images.length];
};

const previousImage = () => {
  const images = product.value?.images || [];
  if (!images.length) return;
  const currentIndex = images.indexOf(selectedImage.value || images[0]);
  selectedImage.value = images[(currentIndex - 1 + images.length) % images.length];
};

const addToCart = async () => {
  if (!product.value || isAddingToCart.value) return;

  isAddingToCart.value = "loading";
  try {
    await addToCartComposable(product.value.id, 1, selectedOptions.value);
    isAddingToCart.value = "added";
    toast.success(`${product.value.name} added to your cart.`);
    window.setTimeout(() => {
      isAddingToCart.value = false;
    }, 1800);
  } catch (error) {
    console.error("Failed to add item to cart:", error);
    toast.error(errorText(error, "There was an issue adding the item to your cart."));
    isAddingToCart.value = false;
  }
};

onBeforeUnmount(closeGallery);

useHead(() => ({
  title: product.value?.name || "Product",
  meta: product.value?.description
    ? [{ name: "description", content: product.value.description.slice(0, 155) }]
    : [],
}));
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-16">
    <div class="container mx-auto max-w-6xl px-6">
      <div v-if="status === 'pending'" class="py-24 text-center">
        <Icon name="svg-spinners:ring-resize" class="mx-auto h-8 w-8" />
        <p class="mt-3 text-gray-600">Loading product…</p>
      </div>

      <div v-else-if="productError || !product" class="py-24 text-center">
        <h1 class="text-3xl font-semibold">Product unavailable</h1>
        <p class="mt-3 text-gray-600">
          We could not load this product from the catalogue.
        </p>
        <button
          type="button"
          class="mt-6 rounded bg-gray-900 px-5 py-3 text-white"
          @click="refresh"
        >
          Try again
        </button>
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-10 rounded-lg bg-white p-6 shadow-lg sm:p-8 lg:grid-cols-2 lg:p-10"
      >
        <div class="flex w-full flex-col items-center">
          <img
            :src="selectedImage || product.images[0] || logoUrl"
            :alt="product.name"
            class="w-full max-w-md rounded-lg bg-gray-100 object-cover shadow-md transition"
            :class="{ 'cursor-pointer hover:scale-[1.01]': product.images.length }"
            @click="openGallery"
          />

          <Swiper
            v-if="product.images.length > 1"
            :modules="[Navigation]"
            :slides-per-view="3"
            :space-between="8"
            navigation
            class="mt-4 w-full"
          >
            <SwiperSlide
              v-for="image in product.images"
              :key="image"
              class="!w-24"
            >
              <button type="button" @click="selectedImage = image">
                <img
                  :src="image"
                  :alt="product.name"
                  class="h-24 w-24 rounded border object-cover transition hover:border-black"
                  :class="selectedImage === image ? 'border-black' : 'border-gray-300'"
                />
              </button>
            </SwiperSlide>
          </Swiper>
        </div>

        <div class="flex flex-col">
          <h1 class="text-4xl font-light tracking-wide text-gray-900">
            {{ product.name }}
          </h1>

          <p class="mt-6 text-3xl font-semibold text-gray-900">
            £{{ Number(product.price).toFixed(2) }}
          </p>

          <p class="mt-8 text-lg leading-relaxed text-gray-700">
            {{ product.shortDescription || product.description }}
          </p>

          <ProductOptions
            v-if="product.option_groups?.length"
            :option-groups="product.option_groups"
            @update:selections="selectedOptions = $event"
          />

          <div class="mt-8 border-b">
            <button
              type="button"
              class="border-b-2 pb-2 text-lg font-light uppercase tracking-wide"
              :class="activeTab === 'description' ? 'border-black text-black' : 'border-transparent text-gray-500'"
              @click="activeTab = 'description'"
            >
              Description
            </button>
            <button
              type="button"
              class="ml-8 border-b-2 pb-2 text-lg font-light uppercase tracking-wide"
              :class="activeTab === 'specs' ? 'border-black text-black' : 'border-transparent text-gray-500'"
              @click="activeTab = 'specs'"
            >
              Specifications
            </button>
          </div>

          <div class="mt-6 text-lg leading-relaxed text-gray-700">
            <p v-if="activeTab === 'description'">
              {{ product.description }}
            </p>
            <p v-else-if="product.specs">{{ product.specs }}</p>
            <p v-else>No specifications available.</p>
          </div>

          <button
            type="button"
            class="mt-10 rounded-lg border border-black bg-white px-8 py-4 text-lg font-light uppercase tracking-wide text-black transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="Boolean(isAddingToCart)"
            @click="addToCart"
          >
            <span v-if="isAddingToCart === 'loading'">Adding…</span>
            <span v-else-if="isAddingToCart === 'added'">Added</span>
            <span v-else>Add to Cart</span>
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="galleryOpen && product"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
        role="dialog"
        aria-modal="true"
        :aria-label="`${product.name} image gallery`"
        @click.self="closeGallery"
      >
        <button
          type="button"
          class="absolute right-5 top-5 text-4xl text-white"
          aria-label="Close gallery"
          @click="closeGallery"
        >
          &times;
        </button>

        <button
          v-if="product.images.length > 1"
          type="button"
          class="absolute left-5 rounded-full bg-black/50 p-4 text-3xl text-white"
          aria-label="Previous image"
          @click.stop="previousImage"
        >
          &#8592;
        </button>

        <img
          :src="selectedImage || product.images[0]"
          :alt="product.name"
          class="max-h-[90vh] max-w-[90vw] object-contain"
        />

        <button
          v-if="product.images.length > 1"
          type="button"
          class="absolute right-5 rounded-full bg-black/50 p-4 text-3xl text-white"
          aria-label="Next image"
          @click.stop="nextImage"
        >
          &#8594;
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style>
.swiper-button-next,
.swiper-button-prev {
  color: #000;
}
</style>
