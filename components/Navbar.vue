<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import logoUrl from "~/assets/images/logo.png";
import { asArray } from "~/utils/apiData";

const isOpen = ref(false);
const isProductDropdownOpen = ref(false);
const isProductMobileOpen = ref(false);
const productCloseTimeout = ref(null);

const { cartItemCount, loadCart } = useCart();

const {
  data: categoryPayload,
  error: categoryError,
  refresh: refreshCategories,
} = await useFetch("/api/categories", {
  key: "navigation-product-categories",
  query: { type: "product" },
  default: () => [],
});

const productCategories = computed(() =>
  asArray(categoryPayload.value, ["categories"]),
);

onMounted(async () => {
  try {
    await loadCart();
  } catch (error) {
    console.error("Navigation cart load failed:", error);
  }
});

const setCloseTimeout = () => {
  clearTimeout(productCloseTimeout.value);
  productCloseTimeout.value = window.setTimeout(() => {
    isProductDropdownOpen.value = false;
  }, 200);
};

const cancelCloseTimeout = () => {
  clearTimeout(productCloseTimeout.value);
};

watch(isOpen, (value) => {
  if (!import.meta.client) return;
  document.body.style.overflow = value ? "hidden" : "";
});

onBeforeUnmount(() => {
  clearTimeout(productCloseTimeout.value);
  if (import.meta.client) document.body.style.overflow = "";
});
</script>

<template>
  <nav
    class="fixed left-0 top-0 z-50 w-full bg-gray-800 py-4 text-gray-100 shadow-md"
    aria-label="Main navigation"
  >
    <div class="container mx-auto flex items-center justify-between px-6">
      <NuxtLink
        to="/"
        class="flex items-center space-x-2 text-2xl font-bold text-white"
        aria-label="Phoenix Vanz home"
      >
        <img :src="logoUrl" alt="" class="h-10 w-auto" />
        <span>Phoenix Vanz</span>
      </NuxtLink>

      <button
        type="button"
        class="fixed right-4 top-4 z-[100] h-8 w-8 text-white focus:outline-none focus:ring-2 focus:ring-white md:hidden"
        :aria-expanded="isOpen"
        aria-controls="mobile-menu"
        :aria-label="isOpen ? 'Close menu' : 'Open menu'"
        @click="isOpen = !isOpen"
      >
        <span
          :class="[
            'absolute left-1 block h-0.5 w-6 bg-white transition duration-300',
            isOpen ? 'top-4 rotate-45' : 'top-2',
          ]"
        />
        <span
          :class="[
            'absolute left-1 top-4 block h-0.5 w-6 bg-white transition-opacity duration-300',
            isOpen ? 'opacity-0' : 'opacity-100',
          ]"
        />
        <span
          :class="[
            'absolute left-1 block h-0.5 w-6 bg-white transition duration-300',
            isOpen ? 'top-4 -rotate-45' : 'top-6',
          ]"
        />
      </button>

      <ul class="hidden items-center space-x-6 md:flex">
        <li class="relative">
          <button
            type="button"
            class="text-white hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-white"
            :aria-expanded="isProductDropdownOpen"
            @focus="isProductDropdownOpen = true"
            @mouseover="isProductDropdownOpen = true; cancelCloseTimeout()"
            @mouseleave="setCloseTimeout"
          >
            Shop by Product
          </button>

          <ul
            v-show="isProductDropdownOpen"
            class="absolute left-0 z-50 mt-2 w-56 rounded-md border bg-white py-1 shadow-lg"
            @mouseover="cancelCloseTimeout"
            @mouseleave="setCloseTimeout"
          >
            <li v-for="category in productCategories" :key="category.id">
              <NuxtLink
                :to="`/shop/${category.slug}`"
                class="block px-4 py-2 text-gray-700 hover:bg-gray-100"
                @click="isProductDropdownOpen = false"
              >
                {{ category.name }}
              </NuxtLink>
            </li>
            <li
              v-if="!productCategories.length && !categoryError"
              class="px-4 py-2 text-sm text-gray-500"
            >
              No product categories available
            </li>
            <li v-if="categoryError" class="px-4 py-2 text-sm text-red-700">
              <button type="button" class="underline" @click="refreshCategories">
                Menu unavailable — retry
              </button>
            </li>
          </ul>
        </li>

        <li>
          <NuxtLink to="/contact" class="text-white hover:text-blue-300">
            Contact
          </NuxtLink>
        </li>
        <li>
          <NuxtLink
            to="/cart"
            class="relative inline-flex text-white hover:text-blue-300"
            aria-label="Shopping cart"
          >
            <Icon name="heroicons:shopping-cart" class="h-6 w-6" />
            <span
              v-if="cartItemCount"
              class="absolute -right-3 -top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs"
            >
              {{ cartItemCount }}
            </span>
          </NuxtLink>
        </li>
      </ul>

      <Transition name="slide">
        <div
          v-if="isOpen"
          id="mobile-menu"
          class="fixed inset-0 z-50 bg-black/50 md:hidden"
          @click.self="isOpen = false"
        >
          <div
            class="fixed right-0 top-0 flex h-full w-72 flex-col space-y-4 bg-black p-6 pt-20 shadow-lg"
          >
            <div>
              <button
                type="button"
                class="flex w-full items-center justify-between text-left text-lg font-medium text-white"
                :aria-expanded="isProductMobileOpen"
                @click="isProductMobileOpen = !isProductMobileOpen"
              >
                Shop by Product
                <span
                  class="transition-transform"
                  :class="{ 'rotate-90': isProductMobileOpen }"
                  aria-hidden="true"
                >
                  &gt;
                </span>
              </button>

              <Transition name="fade">
                <ul
                  v-if="isProductMobileOpen"
                  class="ml-2 mt-3 space-y-2 border-l border-gray-500 pl-3"
                >
                  <li v-for="category in productCategories" :key="category.id">
                    <NuxtLink
                      :to="`/shop/${category.slug}`"
                      class="text-white hover:text-blue-300"
                      @click="isOpen = false"
                    >
                      {{ category.name }}
                    </NuxtLink>
                  </li>
                  <li v-if="!productCategories.length" class="text-sm text-gray-400">
                    No categories available
                  </li>
                </ul>
              </Transition>
            </div>

            <NuxtLink
              to="/contact"
              class="text-lg text-white hover:text-blue-300"
              @click="isOpen = false"
            >
              Contact
            </NuxtLink>

            <NuxtLink
              to="/cart"
              class="text-lg text-white hover:text-blue-300"
              @click="isOpen = false"
            >
              Cart ({{ cartItemCount }})
            </NuxtLink>
          </div>
        </div>
      </Transition>
    </div>
  </nav>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
