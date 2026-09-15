<template>
  <div class="min-h-screen py-16 bg-gray-50">
    <div class="container mx-auto max-w-6xl px-6">
      <div
        v-if="product"
        class="grid grid-cols-1 lg:grid-cols-2 gap-10 bg-white p-6 sm:p-8 lg:p-10 rounded-lg shadow-lg"
      >
        <!-- Images -->
        <div class="flex flex-col items-center w-full">
          <img
            :src="selectedImage || product.images[0] || '/placeholder.jpg'"
            :alt="product.name"
            class="w-full max-w-md object-cover rounded-lg shadow-md cursor-pointer transition hover:scale-105"
            @click="product.images.length ? openGallery() : null"
          />
          <Swiper
            v-if="product.images.length"
            :modules="[Navigation]"
            :slides-per-view="3"
            :space-between="8"
            navigation
            class="w-full mt-4"
          >
            <SwiperSlide
              v-for="(image, index) in product.images"
              :key="index"
              class="!w-24"
            >
              <img
                :src="image"
                :alt="product.name"
                class="w-24 h-24 object-cover rounded cursor-pointer border border-gray-300 hover:border-black transition"
                :class="{ 'border-black': selectedImage === image }"
                @click="selectedImage = image"
              />
            </SwiperSlide>
          </Swiper>
        </div>

        <!-- Details -->
        <div class="flex flex-col">
          <h1 class="text-4xl font-light tracking-wide text-gray-900">
            {{ product.name }}
          </h1>

          <div class="flex items-center space-x-6 mt-6">
            <p class="text-3xl font-semibold text-gray-900">
              £{{ Number(product.price).toFixed(2) }}
            </p>
            <!-- <span
              class="text-sm px-4 py-1 bg-gray-200 text-gray-800 rounded-full font-medium"
            >
              In Stock
            </span> -->
          </div>

          <p class="text-gray-700 mt-8 leading-relaxed text-lg">
            {{ product.shortDescription || product.description }}
          </p>

          <!-- Options -->
          <ProductOptions
            v-if="product.option_groups?.length"
            :option-groups="product.option_groups"
            @update:selections="selectedOptions = $event"
          />

          <!-- Tabs -->
          <div class="mt-8 border-b">
            <button
              @click="activeTab = 'description'"
              class="pb-2 text-lg font-light border-b-2 tracking-wide uppercase"
              :class="
                activeTab === 'description'
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-500'
              "
            >
              Description
            </button>
            <button
              @click="activeTab = 'specs'"
              class="ml-8 pb-2 text-lg font-light border-b-2 tracking-wide uppercase"
              :class="
                activeTab === 'specs'
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-500'
              "
            >
              Specifications
            </button>
          </div>

          <div class="mt-6 text-gray-700 leading-relaxed text-lg">
            <div v-if="activeTab === 'description'">
              <p>{{ product.description }}</p>
            </div>
            <div v-if="activeTab === 'specs'">
              <p v-if="product.specs">{{ product.specs }}</p>
              <p v-else>No specifications available.</p>
            </div>
          </div>

          <button
            class="mt-10 border border-black text-black bg-white hover:bg-black hover:text-white transition py-4 px-8 rounded-lg font-light text-lg tracking-wide uppercase disabled:opacity-50 disabled:cursor-not-allowed"
            @click="addToCart"
            :disabled="isAddingToCart"
          >
            <span v-if="isAddingToCart === 'loading'">Adding...</span>
            <span v-else-if="isAddingToCart === 'added'">Added!</span>
            <span v-else>Add to Cart</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Gallery -->
    <teleport to="body">
      <div
        v-if="galleryOpen"
        class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50"
        @click.self="closeGallery"
      >
        <button
          class="absolute top-5 right-5 text-white text-3xl"
          @click="closeGallery"
        >
          &times;
        </button>

        <button
          v-if="product.images.length > 1"
          class="absolute left-5 text-white text-3xl bg-black bg-opacity-50 p-4 rounded-full"
          @click.stop="prevImage"
        >
          &#8592;
        </button>

        <img
          :src="selectedImage || product.images[0]"
          alt="Gallery Image"
          class="max-w-3xl max-h-screen object-contain"
        />

        <button
          v-if="product.images.length > 1"
          class="absolute right-5 text-white text-3xl bg-black bg-opacity-50 p-4 rounded-full"
          @click.stop="nextImage"
        >
          &#8594;
        </button>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { Swiper, SwiperSlide } from "swiper/vue";
import "swiper/css";
import "swiper/css/navigation";
import { Navigation } from "swiper/modules";
import { eventBus } from "@/utils/eventBus";
import ProductOptions from "@/components/ProductOptions.vue";

const route = useRoute();
const slug = route.params.slug;

const product = ref(null);
const selectedImage = ref(null);
const selectedOptions = ref({});
const activeTab = ref("description");
const galleryOpen = ref(false);
const isAddingToCart = ref(false); // false | 'loading' | 'added'

const { addToCart: addToCartComposable } = useCart();

const fetchProduct = async () => {
  try {
    const res = await $fetch(`/api/products/${slug}`);
    product.value = {
      ...res,
      images: res.productimage_set.map((img) => img.image),
    };
  } catch (err) {
    console.error("Failed to load product", err);
  }
};

onMounted(fetchProduct);

const openGallery = () => {
  galleryOpen.value = true;
  document.addEventListener("keydown", handleKeydown);
};

const closeGallery = () => {
  galleryOpen.value = false;
  document.removeEventListener("keydown", handleKeydown);
};

const handleKeydown = (e) => {
  if (e.key === "Escape") closeGallery();
  if (e.key === "ArrowRight") nextImage();
  if (e.key === "ArrowLeft") prevImage();
};

const nextImage = () => {
  const images = product.value.images;
  const currentIndex = images.indexOf(selectedImage.value || images[0]);
  selectedImage.value = images[(currentIndex + 1) % images.length];
};

const prevImage = () => {
  const images = product.value.images;
  const currentIndex = images.indexOf(selectedImage.value || images[0]);
  selectedImage.value =
    images[(currentIndex - 1 + images.length) % images.length];
};

const addToCart = async () => {
  if (isAddingToCart.value) return;

  isAddingToCart.value = 'loading';
  try {
    await addToCartComposable(product.value.id, 1, selectedOptions.value);
    isAddingToCart.value = 'added';
    // Revert button text after a short delay
    setTimeout(() => {
      isAddingToCart.value = false;
    }, 2000);
  } catch (error) {
    console.error("Failed to add item to cart:", error);
    alert("There was an issue adding the item to your cart. Please try again.");
    isAddingToCart.value = false;
  }
};
</script>

<style>
.swiper-button-next,
.swiper-button-prev {
  color: #000;
}
</style>
