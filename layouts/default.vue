<template>
  <div class="min-h-screen flex flex-col pt-20">
    <Navbar />
    <main class="flex-grow">
      <slot />
    </main>
    <Footer />
    <ToastContainer />
  </div>
</template>
