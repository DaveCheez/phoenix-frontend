<template>
  <section class="py-20 bg-gray-800 text-white">
    <div class="container mx-auto text-center">
      <h1 class="text-4xl text-gray-200 font-bold">Get in Touch</h1>
      <p class="mt-4 text-white">Let's build your dream van together.</p>

      <!-- Contact Info -->
      <div class="mt-8 text-white space-y-2">
        <p class="flex justify-center items-center gap-2">
          📞
          <a href="tel:+447802737739" class="hover:underline">07802 737739</a>
        </p>
        <p class="flex justify-center items-center gap-2">
          📧
          <a href="mailto:dave@fusion-arc.uk" class="hover:underline"
            >sales@phoenixvanz.com</a
          >
        </p>
        <p class="flex justify-center items-center gap-2 text-center">
          📍
          <span
            >Phoenix Vanz, Unit 10, Fairfield Business Park, Fairfield Street,
            Accrington BB5 0LG</span
          >
        </p>
      </div>

      <form class="max-w-lg mx-auto mt-10 bg-gray-300 p-6 rounded-lg shadow-md">
        <div class="mb-4">
          <label class="block text-gray-800">Name</label>
          <input type="text" class="w-full p-2 border rounded-md text-gray-800" />
        </div>
        <div class="mb-4">
          <label class="block text-gray-800">Phone</label>
          <input type="tel" class="w-full p-2 border rounded-md text-gray-800" />
        </div>
        <div class="mb-4">
          <label class="block text-gray-800">Email</label>
          <input type="email" class="w-full p-2 border rounded-md text-gray-800" />
        </div>
        <div class="mb-4">
          <label class="block text-gray-800">Message</label>
          <textarea class="w-full p-2 border rounded-md text-gray-800"></textarea>
        </div>
        <button class="w-full bg-blue-900 text-gray-100 py-2 rounded-lg">
          Send Message
        </button>
      </form>
    </div>

    <!-- Google Map Embed -->
    <div class="mt-20 mx-auto max-w-4xl px-4">
      <iframe
        src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2382.720247676672!2d-2.361761384053413!3d53.75010598007048!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x487b9dc63f0557df%3A0x23a5d891ce20f0fc!2sPhoenix%20Vanz%2C%20Unit%2010%2C%20Fairfield%20Business%20Park%2C%20Fairfield%20St%2C%20Accrington%20BB5%200LG%2C%20UK!5e0!3m2!1sen!2sus!4v1713524307537!5m2!1sen!2sus"
        width="100%"
        height="450"
        style="border: 0"
        allowfullscreen
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
    </div>
  </section>
</template>
