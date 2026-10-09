<script setup>
import { nextTick, reactive, ref } from "vue";

useHead({
  title: "Contact Phoenix Vanz",
  meta: [
    {
      name: "description",
      content:
        "Contact Phoenix Vanz in Accrington about bespoke campervan roof racks, ladders, carriers and fitting.",
    },
  ],
});

const pageUrl = useRequestURL();

const form = reactive({
  name: "",
  email: "",
  phone: "",
  message: "",
  website: "",
});

const fieldErrors = reactive({
  name: "",
  email: "",
  phone: "",
  message: "",
  website: "",
});

const submitting = ref(false);
const formError = ref("");
const successMessage = ref("");
const successReference = ref("");
const successRegion = ref(null);

const fieldIds = {
  name: "contact-name",
  email: "contact-email",
  phone: "contact-phone",
  message: "contact-message",
  website: "contact-website",
};

function describedBy(field) {
  return fieldErrors[field] ? `${fieldIds[field]}-error` : undefined;
}

function resetCustomerFields() {
  form.name = "";
  form.email = "";
  form.phone = "";
  form.message = "";
  form.website = "";
}

function clearFieldErrors() {
  fieldErrors.name = "";
  fieldErrors.email = "";
  fieldErrors.phone = "";
  fieldErrors.message = "";
  fieldErrors.website = "";
}

function firstMessage(value) {
  if (Array.isArray(value) && value.length) return String(value[0] || "");
  if (typeof value === "string") return value;
  return "";
}

function applyServerFieldErrors(errors) {
  if (!errors || typeof errors !== "object") return;
  for (const field of Object.keys(fieldErrors)) {
    fieldErrors[field] = firstMessage(errors[field]);
  }
}

function clientFieldErrors() {
  const errors = {};
  const name = form.name.trim();
  const email = form.email.trim();
  const phone = form.phone.trim();
  const message = form.message.trim();

  if (!name) errors.name = "Enter your name.";
  else if (name.length > 120) errors.name = "Name must be 120 characters or fewer.";

  if (!email) errors.email = "Enter your email address.";
  else if (!email.includes("@")) errors.email = "Enter a valid email address.";

  if (phone.length > 50) errors.phone = "Phone must be 50 characters or fewer.";

  if (!message) errors.message = "Enter a message.";
  else if (message.length > 5000) {
    errors.message = "Message must be 5000 characters or fewer.";
  }

  return errors;
}

async function submitEnquiry() {
  if (submitting.value) return;

  formError.value = "";
  successMessage.value = "";
  successReference.value = "";
  clearFieldErrors();

  const localErrors = clientFieldErrors();
  if (Object.keys(localErrors).length) {
    Object.assign(fieldErrors, localErrors);
    formError.value = "Please correct the highlighted fields.";
    return;
  }

  submitting.value = true;

  try {
    const response = await $fetch.raw("/api/contact", {
      method: "POST",
      body: {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        website: form.website,
        source_url: `${pageUrl.origin}${pageUrl.pathname}`,
      },
    });

    const data = response._data || {};
    if (response.status === 201 && data.success === true) {
      successMessage.value =
        data.message ||
        "Thanks — your enquiry has been received. We will get back to you shortly.";
      successReference.value = data.reference || "";
      resetCustomerFields();
      clearFieldErrors();
      await nextTick();
      successRegion.value?.focus?.();
      return;
    }

    formError.value =
      data.error ||
      "We could not send your enquiry right now. Please try again shortly or contact Phoenix Vanz by phone.";
  } catch (error) {
    const data = error?.data || error?.response?._data || {};
    applyServerFieldErrors(data.errors);

    const safeError =
      typeof data.error === "string" && data.code !== "CONTACT_PROXY_FORBIDDEN"
        ? data.error
        : "";

    formError.value =
      safeError ||
      "We could not send your enquiry right now. Please try again shortly or contact Phoenix Vanz by phone.";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="py-20 bg-gray-800 text-white">
    <div class="container mx-auto text-center">
      <h1 class="text-4xl text-gray-200 font-bold">Get in Touch</h1>
      <p class="mt-4 text-white">Let's build your dream van together.</p>

      <div class="mt-8 text-white space-y-2">
        <p class="flex justify-center items-center gap-2">
          📞
          <a href="tel:+447802737739" class="hover:underline">07802 737739</a>
        </p>
        <p class="flex justify-center items-center gap-2">
          📧
          <a href="mailto:sales@phoenixvanz.com" class="hover:underline">
            sales@phoenixvanz.com
          </a>
        </p>
        <p class="flex justify-center items-center gap-2 text-center">
          📍
          <span>
            Phoenix Vanz, Unit 10, Fairfield Business Park, Fairfield Street,
            Accrington BB5 0LG
          </span>
        </p>
      </div>

      <form
        class="relative max-w-lg mx-auto mt-10 bg-gray-300 p-6 rounded-lg shadow-md text-left"
        :aria-busy="submitting ? 'true' : 'false'"
        @submit.prevent="submitEnquiry"
      >
        <div
          v-if="successMessage"
          id="contact-success"
          ref="successRegion"
          tabindex="-1"
          role="status"
          aria-live="polite"
          class="mb-4 rounded bg-green-100 p-3 text-gray-900 outline-none"
        >
          <p>{{ successMessage }}</p>
          <p v-if="successReference" class="mt-2 font-semibold">
            Your reference: {{ successReference }}
          </p>
        </div>

        <div
          v-if="formError"
          id="contact-form-error"
          role="alert"
          class="mb-4 rounded bg-red-100 p-3 text-red-800"
        >
          {{ formError }}
        </div>

        <div
          class="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
          aria-hidden="true"
        >
          <label for="contact-website">Website</label>
          <input
            id="contact-website"
            v-model="form.website"
            type="text"
            name="website"
            tabindex="-1"
            autocomplete="off"
          />
        </div>

        <div class="mb-4">
          <label for="contact-name" class="block text-gray-800">Name</label>
          <input
            id="contact-name"
            v-model="form.name"
            type="text"
            name="name"
            required
            maxlength="120"
            autocomplete="name"
            class="w-full p-2 border rounded-md text-gray-800"
            :aria-invalid="fieldErrors.name ? 'true' : 'false'"
            :aria-describedby="describedBy('name')"
          />
          <p
            v-if="fieldErrors.name"
            id="contact-name-error"
            class="mt-1 text-sm text-red-700"
          >
            {{ fieldErrors.name }}
          </p>
        </div>

        <div class="mb-4">
          <label for="contact-email" class="block text-gray-800">Email</label>
          <input
            id="contact-email"
            v-model="form.email"
            type="email"
            name="email"
            required
            maxlength="254"
            autocomplete="email"
            class="w-full p-2 border rounded-md text-gray-800"
            :aria-invalid="fieldErrors.email ? 'true' : 'false'"
            :aria-describedby="describedBy('email')"
          />
          <p
            v-if="fieldErrors.email"
            id="contact-email-error"
            class="mt-1 text-sm text-red-700"
          >
            {{ fieldErrors.email }}
          </p>
        </div>

        <div class="mb-4">
          <label for="contact-phone" class="block text-gray-800">
            Phone
            <span class="font-normal text-gray-600">(optional)</span>
          </label>
          <input
            id="contact-phone"
            v-model="form.phone"
            type="tel"
            name="phone"
            maxlength="50"
            autocomplete="tel"
            class="w-full p-2 border rounded-md text-gray-800"
            :aria-invalid="fieldErrors.phone ? 'true' : 'false'"
            :aria-describedby="describedBy('phone')"
          />
          <p
            v-if="fieldErrors.phone"
            id="contact-phone-error"
            class="mt-1 text-sm text-red-700"
          >
            {{ fieldErrors.phone }}
          </p>
        </div>

        <div class="mb-4">
          <label for="contact-message" class="block text-gray-800">Message</label>
          <textarea
            id="contact-message"
            v-model="form.message"
            name="message"
            required
            maxlength="5000"
            rows="5"
            class="w-full p-2 border rounded-md text-gray-800"
            :aria-invalid="fieldErrors.message ? 'true' : 'false'"
            :aria-describedby="describedBy('message')"
          />
          <p
            v-if="fieldErrors.message"
            id="contact-message-error"
            class="mt-1 text-sm text-red-700"
          >
            {{ fieldErrors.message }}
          </p>
        </div>

        <button
          type="submit"
          class="w-full bg-blue-900 text-gray-100 py-2 rounded-lg disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="submitting"
        >
          {{ submitting ? "Sending…" : "Send Message" }}
        </button>
      </form>
    </div>

    <div class="mt-20 mx-auto max-w-4xl px-4">
      <iframe
        title="Map of Phoenix Vanz, Unit 10 Fairfield Business Park, Accrington"
        src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2382.720247676672!2d-2.361761384053413!3d53.75010598007048!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x487b9dc63f0557df%3A0x23a5d891ce20f0fc!2sPhoenix%20Vanz%2C%20Unit%2010%2C%20Fairfield%20Business%20Park%2C%20Fairfield%20St%2C%20Accrington%20BB5%200LG%2C%20UK!5e0!3m2!1sen!2sus!4v1713524307537!5m2!1sen!2sus"
        width="100%"
        height="450"
        style="border: 0"
        allowfullscreen
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
      />
    </div>
  </section>
</template>
