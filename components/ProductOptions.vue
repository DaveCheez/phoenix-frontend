<template>
  <div v-if="normalisedGroups.length" class="mt-8 space-y-6">
    <fieldset
      v-for="group in normalisedGroups"
      :key="group.id"
      class="border-t pt-6"
      :aria-invalid="isGroupInvalid(group) ? 'true' : 'false'"
      :aria-describedby="groupDescribedBy(group)"
    >
      <legend class="text-lg font-semibold text-gray-800">
        {{ group.name }}
        <span class="ml-1 font-normal text-gray-600">
          {{ group.required ? "(required)" : "(optional)" }}
        </span>
      </legend>

      <p
        v-if="group.help_text"
        :id="helpId(group)"
        class="mt-2 text-sm text-gray-600"
      >
        {{ group.help_text }}
      </p>

      <div class="mt-3 space-y-1" role="presentation">
        <label
          v-for="option in groupOptions(group)"
          :key="option.id"
          :for="optionInputId(group, option)"
          class="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-black has-[:focus-visible]:ring-offset-2"
        >
          <input
            :id="optionInputId(group, option)"
            v-model.number="selected[groupKey(group)]"
            type="radio"
            class="h-5 w-5 shrink-0 accent-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            :name="groupName(group)"
            :value="Number(option.id)"
            :aria-describedby="groupDescribedBy(group)"
            :aria-invalid="isGroupInvalid(group) ? 'true' : 'false'"
          />
          <span
            class="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
          >
            <span class="break-words text-gray-900">{{ option.name }}</span>
            <span class="shrink-0 text-sm text-gray-700">
              {{ optionAdjustmentLabel(option) }}
            </span>
          </span>
        </label>
      </div>

      <p
        v-if="isGroupInvalid(group)"
        :id="errorId(group)"
        class="mt-3 text-sm text-red-700"
        role="alert"
      >
        Choose an option for {{ group.name }}.
      </p>
    </fieldset>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps({
  productId: {
    type: [Number, String],
    default: null,
  },
  optionGroups: {
    type: Array,
    default: () => [],
  },
  reportErrors: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:state"]);

const selected = ref({});

const normalisedGroups = computed(() =>
  Array.isArray(props.optionGroups)
    ? props.optionGroups.filter((group) => group && group.id != null)
    : [],
);

const groupsKey = computed(() =>
  normalisedGroups.value
    .map((group) => {
      const optionIds = Array.isArray(group.options)
        ? group.options.map((option) => option?.id).join(",")
        : "";
      return `${group.id}:${optionIds}`;
    })
    .join("|"),
);

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

const optionAdjustmentLabel = (option) => {
  const pence = optionAdjustmentPence(option);
  return pence > 0 ? `+£${formatPence(pence)}` : "Included";
};

const groupKey = (group) => String(group.id);

const groupOptions = (group) =>
  Array.isArray(group?.options)
    ? group.options.filter((option) => option && option.id != null)
    : [];

const defaultOptionId = (group) => {
  const options = Array.isArray(group?.options) ? group.options : [];
  const fallback = options.find(
    (option) => option && (option.is_default === true || option.is_default === 1),
  );
  const id = Number(fallback?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const selectedOptionId = (group) => {
  const raw = selected.value[groupKey(group)];
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const isRequiredGroup = (group) => Boolean(group?.required);

const isGroupInvalid = (group) =>
  Boolean(
    props.reportErrors && isRequiredGroup(group) && selectedOptionId(group) == null,
  );

const missingRequiredGroupIds = computed(() =>
  normalisedGroups.value
    .filter((group) => isRequiredGroup(group) && selectedOptionId(group) == null)
    .map((group) => group.id),
);

const optionIds = computed(() => {
  const ids = [];
  const seen = new Set();

  for (const group of normalisedGroups.value) {
    const id = selectedOptionId(group);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
});

const isValid = computed(() => missingRequiredGroupIds.value.length === 0);

const productPrefix = computed(() => {
  const id = Number(props.productId);
  return Number.isInteger(id) && id > 0 ? String(id) : "product";
});

const groupName = (group) =>
  `product-${productPrefix.value}-group-${group.id}`;

const optionInputId = (group, option) =>
  `product-${productPrefix.value}-group-${group.id}-option-${option.id}`;

const helpId = (group) =>
  `product-${productPrefix.value}-group-${group.id}-help`;

const errorId = (group) =>
  `product-${productPrefix.value}-group-${group.id}-error`;

const groupDescribedBy = (group) => {
  const ids = [];
  if (group.help_text) ids.push(helpId(group));
  if (isGroupInvalid(group)) ids.push(errorId(group));
  return ids.length ? ids.join(" ") : undefined;
};

const emitState = () => {
  emit("update:state", {
    selections: { ...selected.value },
    optionIds: [...optionIds.value],
    missingRequiredGroupIds: [...missingRequiredGroupIds.value],
    isValid: isValid.value,
  });
};

const initialiseSelections = () => {
  const next = {};

  for (const group of normalisedGroups.value) {
    next[groupKey(group)] = defaultOptionId(group);
  }

  selected.value = next;
  emitState();
};

const focusFirstInvalidGroup = async () => {
  if (!import.meta.client) return;

  const group = normalisedGroups.value.find((item) => isGroupInvalid(item));
  const option = group ? groupOptions(group)[0] : null;
  if (!group || !option) return;

  await nextTick();
  const input = document.getElementById(optionInputId(group, option));
  if (input && typeof input.focus === "function") input.focus();
};

watch(
  () => [props.productId, groupsKey.value],
  initialiseSelections,
  { immediate: true },
);

watch(
  [selected, missingRequiredGroupIds, optionIds, isValid],
  emitState,
  { deep: true },
);

watch(
  () => props.reportErrors,
  async (reportErrors) => {
    if (!reportErrors || isValid.value) return;
    await focusFirstInvalidGroup();
  },
);

defineExpose({
  optionIds,
  isValid,
  missingRequiredGroupIds,
  focusFirstInvalidGroup,
});
</script>
