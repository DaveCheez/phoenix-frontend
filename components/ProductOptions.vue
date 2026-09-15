<template>
  <div v-if="optionGroups.length" class="mt-8 space-y-6">
    <div v-for="group in optionGroups" :key="group.id" class="border-t pt-6">
        <h3 class="text-lg font-semibold text-gray-800 mb-3">{{ group.name }}</h3>

      <!-- Required → radios | Optional → checkboxes -->
      <div class="space-y-2">
        <div
          v-for="option in group.options"
          :key="option.id"
          class="flex items-center gap-3"
        >
          <input
            :type="group.required ? 'radio' : 'checkbox'"
            :name="`group-${group.id}`"
            :value="option.id"
            v-model="selected[group.id]"
            :id="`option-${option.id}`"
          />
          <label :for="`option-${option.id}`" class="cursor-pointer">
            {{ option.name }}
            <span v-if="option.price > 0">
              — £{{ Number(option.price).toFixed(2) }}</span
            >
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, watch, onMounted } from "vue";

const props = defineProps({
  optionGroups: Array,
});

const emit = defineEmits(["update:selections"]);

const selected = reactive({});

const initializeSelections = () => {
  props.optionGroups.forEach(group => {
    // For optional (checkbox) groups, initialize with an empty array.
    // For required (radio) groups, initialize with null.
    selected[group.id] = group.required ? null : [];
  });
};

onMounted(initializeSelections);

// Watch for changes and emit them to the parent.
watch(selected, (newSelections) => {
  emit("update:selections", newSelections);
}, { deep: true });
</script>
