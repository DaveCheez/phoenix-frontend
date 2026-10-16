<template>
  <div class="space-y-1 text-sm leading-relaxed text-gray-700">
    <p class="font-semibold text-gray-900">{{ PURCHASE_TERMS.heading }}</p>
    <p>{{ PURCHASE_TERMS.included }}</p>
    <p>{{ PURCHASE_TERMS.leadTime }}</p>
  </div>
</template>

<script setup>
import { PURCHASE_TERMS } from "~/utils/purchaseTerms";
</script>
