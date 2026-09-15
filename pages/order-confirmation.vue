<template>
  <div class="max-w-xl mx-auto p-6 text-center">
    <h1 class="text-2xl font-bold mb-4">Thank you for your order!</h1>
    <p class="text-gray-600 mb-4">
      Your order has been successfully placed. We will be in touch soon.
    </p>

    <div class="bg-gray-100 p-4 rounded text-left">
      <p><strong>Name:</strong> {{ route.query.name }}</p>
      <p><strong>Email:</strong> {{ route.query.email }}</p>
      <p><strong>City:</strong> {{ route.query.city }}</p>
    </div>

    <NuxtLink to="/" class="mt-6 inline-block text-blue-600 hover:underline"
      >Return to Home</NuxtLink
    >
  </div>
</template>

<script setup>
import { useRoute } from "vue-router";

const route = useRoute();
</script>
