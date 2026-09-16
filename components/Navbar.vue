<script setup>
import { ref, onMounted, watch } from "vue";

const isOpen = ref(false);
const isProductDropdownOpen = ref(false);
const productCategories = ref([]);

const isProductMobileOpen = ref(false);

const { cartItemCount, loadCart } = useCart();

// Fetch categories from API
const fetchCategories = async () => {
  try {
    // Explicitly fetch product categories
    const data = await $fetch("/api/categories?type=product");
    productCategories.value = data;
  } catch (error) {
    console.error("Fetch error:", error);
  }
};

onMounted(async () => {
  await Promise.allSettled([fetchCategories(), loadCart()]);
});

const productCloseTimeout = ref(null);

const setCloseTimeout = () => {
  const timeoutRef = productCloseTimeout;
  const isOpenRef = isProductDropdownOpen;
  timeoutRef.value = setTimeout(() => {
    isOpenRef.value = false;
  }, 200); // Short delay before closing
};

const cancelCloseTimeout = () => {
  const timeoutRef = productCloseTimeout;
  clearTimeout(timeoutRef.value);
};

watch(isOpen, (val) => {
  document.body.style.overflow = val ? "hidden" : "";
});
</script>

<template>
  <nav class="bg-gray-800 fixed w-full z-10 top-0 left-0 shadow-md py-4 text-gray-100">
    <div class="container mx-auto flex justify-between items-center px-6">
      <!-- Logo -->
      <NuxtLink
        to="/"
        class="flex items-center space-x-2 text-2xl font-bold text-white"
      >
        <img
          src="/images/logo.png"
          alt="Phoenix Vanz Logo"
          class="h-10 w-auto"
        />
        <span>Phoenix Vanz</span>
      </NuxtLink>

      <!-- Burger/X button (fixed in top-right on mobile) -->
      <button
        @click="isOpen = !isOpen"
        class="md:hidden fixed top-4 right-4 z-[100] w-6 h-6 focus:outline-none text-white"
      >
        <!-- Top line -->
        <span
          :class="[
            'block absolute h-0.5 w-6 bg-white transform transition duration-300 ease-in-out',
            isOpen ? 'rotate-45 top-2.5' : 'top-1',
          ]"
        />

        <!-- Middle line -->
        <span
          :class="[
            'block absolute h-0.5 w-6 bg-white transition-opacity duration-300 ease-in-out',
            isOpen ? 'opacity-0' : 'top-2.5',
          ]"
        />

        <!-- Bottom line -->
        <span
          :class="[
            'block absolute h-0.5 w-6 bg-white transform transition duration-300 ease-in-out',
            isOpen ? '-rotate-45 top-2.5' : 'top-4',
          ]"
        />
      </button>

      <!-- Desktop Menu -->
      <ul class="hidden md:flex space-x-6">
        <li class="relative">
          <button
            class="hover:text-blue-400 text-white focus:outline-none"
            @mouseover="isProductDropdownOpen = true; cancelCloseTimeout()"
            @mouseleave="setCloseTimeout()"
          >
            Shop by Product
          </button>

          <ul
            v-if="productCategories.length > 0"
            v-show="isProductDropdownOpen"
            class="absolute left-0 mt-2 w-48 bg-white shadow-lg border rounded-md z-50"
            @mouseover="cancelCloseTimeout()"
            @mouseleave="setCloseTimeout()"
          >
            <li v-for="category in productCategories" :key="category.id">
              <NuxtLink
                :to="`/shop/${category.slug}`"
                class="block px-4 py-2 text-gray-700 hover:bg-gray-100"
              >
                {{ category.name }}
              </NuxtLink>
            </li>
            <li
              v-if="productCategories.length === 0"
              class="px-4 py-2 text-gray-500"
            >
              No products available
            </li>
          </ul>
        </li>

        <li>
          <NuxtLink to="/contact" class="hover:text-blue-400 text-white"
            >Contact</NuxtLink
          >
        </li>
        <li>
          <NuxtLink to="/cart" class="relative text-white hover:text-blue-400">
            <Icon name="heroicons:shopping-cart" class="w-6 h-6" />
            <span
              v-if="cartItemCount"
              class="absolute -top-2 -right-2 bg-red-500 text-xs w-5 h-5 flex items-center justify-center rounded-full"
            >
              {{ cartItemCount }}
            </span>
          </NuxtLink>
        </li>
      </ul>

      <!-- Mobile Menu -->
      <!-- Mobile Slide-in Menu -->
      <Transition name="slide">
        <div
          v-if="isOpen"
          class="fixed inset-0 z-50 bg-black bg-opacity-50 md:hidden"
        >
          <!-- Slide-out panel -->
          <div class="fixed top-0 right-0 w-64 h-full bg-black shadow-lg p-6 flex flex-col space-y-4 transform transition-transform duration-300 pt-20">

              <!-- Shop by Product -->
              <div class="mt-4">
                <button
                  @click="isProductMobileOpen = !isProductMobileOpen"
                  class="w-full text-left text-lg font-medium flex justify-between items-center text-white"
                >
                  Shop by Product
                  <span
                    :class="[
                      'text-sm transform transition-transform duration-300',
                      isProductMobileOpen ? 'rotate-90' : '',
                    ]"
                  >
                    &gt;
                  </span>
                </button>
                <Transition name="fade">
                  <ul
                    v-if="isProductMobileOpen"
                    class="mt-2 ml-2 pl-2 border-l border-gray-200 space-y-2"
                  >
                    <li v-for="cat in productCategories" :key="cat.id">
                      <NuxtLink
                        :to="`/shop/${cat.slug}`"
                        class="text-white hover:text-blue-500"
                        @click="isOpen = false"
                      >
                        {{ cat.name }}
                      </NuxtLink>
                    </li>
                    <li
                      v-if="productCategories.length === 0"
                      class="text-gray-500 text-sm"
                    >
                      No products available
                    </li>
                  </ul>
                </Transition>
              </div>

              <NuxtLink
                to="/contact"
                class="text-lg text-white hover:text-blue-500"
                @click="isOpen = false"
              >
                Contact
              </NuxtLink>

              <NuxtLink
                to="/cart"
                class="text-lg text-white hover:text-blue-500"
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

.slide-enter-to,
.slide-leave-from {
  transform: translateX(0%);
  opacity: 1;
}
</style>
