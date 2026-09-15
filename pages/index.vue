<template>
  <section
    class="relative min-h-screen flex items-center justify-center overflow-hidden"
  >
    <!-- Background Images (Sliding) -->
    <div
      v-for="(image, index) in images"
      :key="index"
      class="absolute inset-0 bg-cover bg-center transition-opacity duration-2000"
      :style="{
        backgroundImage: `url(${image})`,
        opacity: currentIndex === index ? 1 : 0,
      }"
    ></div>

    <!-- Text Content -->
    <div class="relativetext-center px-4">
      <h1
        class="text-5xl sm:text-6xl font-extrabold text-white underline decoration-white decoration-4 underline-offset-8 drop-shadow-lg"
      >
        Phoenix Vanz
      </h1>
      <p class="mt-4 text-lg sm:text-xl text-white drop-shadow-lg">
        Bespoke fabrication for your van
      </p>
    </div>
  </section>
  
  <!-- Accessories Section -->
  <AccessoriesGrid />

  <!-- Blurb Section -->
  <section class="py-16 bg-black text-white">
    <div class="container mx-auto text-center max-w-5xl">
      <h2 class="text-3xl font-bold mb-6 text-white">
        Elevate Your Van with Phoenix Vanz
      </h2>
      <p class="text-lg text-white leading-relaxed">
        Looking for a rugged, custom-fit roof rack or ladder system for your VW
        Crafter, Mercedes Sprinter, or MAN TGE? At Phoenix Vanz, we specialize
        in bespoke, high-quality solutions designed for durability, safety, and
        efficiency. Built from premium materials to withstand heavy loads and
        tough conditions, our systems ensure your van is ready for both work and
        adventure. Whether you're a tradesperson, explorer, or both, our expert
        team tailors every setup to meet your needs. Experience exceptional
        craftsmanship and unmatched customer service—we're here to help every
        step of the way. Upgrade your van today! 🚐🔥
      </p>
    </div>
  </section>

  <CustomerReviews />
</template>

<script setup>
const visibleCount = 3;

const reviews = [
  {
    name: "John D.",
    content: "Fantastic craftsmanship! My van has never looked better.",
    timeAgo: "2 weeks ago",
  },
  {
    name: "Sarah P.",
    content: "Superb quality and quick delivery. Highly recommend!",
    timeAgo: "1 month ago",
  },
  {
    name: "Michael B.",
    content: "Phoenix Vanz exceeded my expectations!",
    timeAgo: "3 weeks ago",
  },
  {
    name: "Emma R.",
    content: "The customer service was top-notch, and the product is amazing.",
    timeAgo: "5 days ago",
  },
  {
    name: "Chris M.",
    content: "Love the custom build they did for my van. Worth every penny!",
    timeAgo: "1 week ago",
  },
  {
    name: "Linda K.",
    content: "Strong, durable, and looks great. Will be buying more soon.",
    timeAgo: "2 months ago",
  },
  {
    name: "James W.",
    content: "Best accessories for vans I’ve ever purchased!",
    timeAgo: "3 weeks ago",
  },
  {
    name: "Rebecca L.",
    content: "Easy to install and makes a huge difference. A+ quality!",
    timeAgo: "4 days ago",
  },
  {
    name: "David G.",
    content: "Superb value for money. Really happy with my order!",
    timeAgo: "1 month ago",
  },
  {
    name: "Olivia N.",
    content: "Professional and friendly team. Highly recommended.",
    timeAgo: "6 days ago",
  },
];
</script>
<script>
export default {
  data() {
    return {
      images: [
        "/images/home/crafter-beach.jpg",
        "/images/home/crafter-bike.jpg",
        "/images/home/sidebar.jpg",
      ],
      currentIndex: 0,
    };
  },
  mounted() {
    setInterval(() => {
      this.currentIndex = (this.currentIndex + 1) % this.images.length;
    }, 4000); // Change every 4 seconds
  },
};
</script>

<style scoped>
/* Ensure smooth transitions */
.absolute {
  transition: opacity 1.5s ease-in-out;
}
</style>
