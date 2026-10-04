<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/vue";
import "swiper/css";
import "swiper/css/navigation";

import ProductOptions from "@/components/ProductOptions.vue";
import logoUrl from "~/assets/images/logo.png";
import { logCartFailure } from "~/utils/cartClient";

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
const optionState = ref({
  selections: {},
  optionIds: [],
  missingRequiredGroupIds: [],
  isValid: true,
});
const showOptionErrors = ref(false);
const hasReceivedOptionState = ref(false);
const activeTab = ref("description");
const galleryOpen = ref(false);
const isAddingToCart = ref(false);

const {
  access,
  pending,
  addToCart: addToCartComposable,
  recoverBasket,
} = useCart();
const toast = useToast();

const penceFromDecimalString = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^([0-9]+)(?:\.([0-9]{1,2}))?$/);
  if (!match) return 0;

  const pounds = Number.parseInt(match[1], 10);
  const fraction = (match[2] || "").padEnd(2, "0");
  const pence = Number.parseInt(fraction, 10);
  if (!Number.isInteger(pounds) || !Number.isInteger(pence)) return 0;

  return pounds * 100 + pence;
};

const formatPence = (pence) => {
  const safe = Number.isInteger(pence) && pence > 0 ? pence : 0;
  const pounds = Math.trunc(safe / 100);
  const remainder = safe % 100;
  const fraction = remainder < 10 ? `0${remainder}` : String(remainder);
  return `${pounds}.${fraction}`;
};

const optionAdjustmentPence = (option) => {
  const raw = option?.price_adjustment ?? option?.price ?? "0.00";
  const pence = penceFromDecimalString(raw);
  return pence > 0 ? pence : 0;
};

const optionGroups = computed(() =>
  Array.isArray(product.value?.option_groups) ? product.value.option_groups : [],
);

const hasRequiredGroups = computed(() =>
  optionGroups.value.some((group) => group?.required),
);

const selectedOptionIds = computed(() => {
  const ids = [];
  const seen = new Set();

  for (const id of optionState.value.optionIds || []) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
});

const optionsValid = computed(() => {
  if (!optionGroups.value.length) return true;
  if (!hasReceivedOptionState.value) return false;
  return optionState.value.isValid === true;
});

const basePricePence = computed(() =>
  penceFromDecimalString(product.value?.price ?? "0.00"),
);

const findOptionById = (optionId) => {
  for (const group of optionGroups.value) {
    const options = Array.isArray(group?.options) ? group.options : [];
    for (const option of options) {
      if (Number(option?.id) === optionId) return option;
    }
  }
  return null;
};

const selectedOptionsPence = computed(() => {
  let total = 0;
  for (const id of selectedOptionIds.value) {
    total += optionAdjustmentPence(findOptionById(id));
  }
  return total;
});

const configuredPricePence = computed(
  () => basePricePence.value + selectedOptionsPence.value,
);

const formattedBasePrice = computed(() => formatPence(basePricePence.value));
const formattedSelectedOptionsPrice = computed(() => {
  const pence = selectedOptionsPence.value;
  return pence > 0 ? `+£${formatPence(pence)}` : `£${formatPence(0)}`;
});
const formattedConfiguredPrice = computed(() =>
  formatPence(configuredPricePence.value),
);

const optionPicker = ref(null);
const addToCartHintId = "product-add-to-cart-hint";
const addToCartBusy = computed(() => isAddingToCart.value === "loading");
const addToCartAriaDisabled = computed(
  () => !addToCartBusy.value && !optionsValid.value,
);

const onOptionStateUpdate = (state) => {
  hasReceivedOptionState.value = true;
  optionState.value = {
    selections: state?.selections && typeof state.selections === "object"
      ? state.selections
      : {},
    optionIds: Array.isArray(state?.optionIds) ? state.optionIds : [],
    missingRequiredGroupIds: Array.isArray(state?.missingRequiredGroupIds)
      ? state.missingRequiredGroupIds
      : [],
    isValid: state?.isValid !== false,
  };
};

const cartErrorMessage = (error) =>
  error?.customerMessage || "We could not confirm the latest basket update. Check your basket before trying the change again.";

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

watch(
  () => [product.value?.id, slug.value],
  () => {
    showOptionErrors.value = false;
    hasReceivedOptionState.value = false;
    if (!optionGroups.value.length) {
      hasReceivedOptionState.value = true;
      optionState.value = {
        selections: {},
        optionIds: [],
        missingRequiredGroupIds: [],
        isValid: true,
      };
    }
  },
);

const addToCart = async () => {
  if (!product.value || addToCartBusy.value) return;

  if (!optionsValid.value) {
    showOptionErrors.value = true;
    await nextTick();
    optionPicker.value?.focusFirstInvalidGroup?.();
    return;
  }

  isAddingToCart.value = "loading";
  try {
    const result = await addToCartComposable(product.value.id, 1, selectedOptionIds.value);
    if (result?.ok !== true) {
      isAddingToCart.value = false;
      return;
    }
    isAddingToCart.value = "added";
    toast.success(`${product.value.name} added to your cart.`);
    window.setTimeout(() => {
      isAddingToCart.value = false;
    }, 1800);
  } catch (error) {
    logCartFailure("cart-add", error);
    toast.error(cartErrorMessage(error));
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

          <div class="mt-6 space-y-2">
            <p class="text-lg text-gray-700">
              Base price: £{{ formattedBasePrice }}
            </p>
            <p class="text-lg text-gray-700">
              Selected options: {{ formattedSelectedOptionsPrice }}
            </p>
            <p
              class="text-3xl font-semibold text-gray-900"
              aria-live="polite"
            >
              Estimated configured price: £{{ formattedConfiguredPrice }}
            </p>
            <p class="text-sm text-gray-600">
              This is an estimate. Your cart will show the confirmed price from
              Phoenix Vanz.
            </p>
          </div>

          <p class="mt-8 text-lg leading-relaxed text-gray-700">
            {{ product.shortDescription || product.description }}
          </p>

          <ProductOptions
            v-if="optionGroups.length"
            ref="optionPicker"
            :product-id="product.id"
            :option-groups="optionGroups"
            :report-errors="showOptionErrors"
            @update:state="onOptionStateUpdate"
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

          <p
            v-if="hasRequiredGroups"
            :id="addToCartHintId"
            class="mt-6 text-sm text-gray-600"
          >
            Choose an option for every required group before adding this product.
          </p>

          <CartSessionNotice
            class="mt-6"
            :access="access === 'ready' || access === 'loading' ? '' : access"
            :pending="pending"
            @action="recoverBasket"
          />

          <button
            type="button"
            class="rounded-lg border border-black bg-white px-8 py-4 text-lg font-light uppercase tracking-wide text-black transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            :class="hasRequiredGroups ? 'mt-4' : 'mt-10'"
            :disabled="addToCartBusy"
            :aria-disabled="addToCartAriaDisabled ? 'true' : undefined"
            :aria-describedby="hasRequiredGroups ? addToCartHintId : undefined"
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
