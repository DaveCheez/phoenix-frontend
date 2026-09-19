<template>
  <div class="flex min-h-screen flex-col pt-20">
    <Navbar />
    <main class="flex-grow">
      <slot />
    </main>
    <Footer />
    <ClientOnly>
      <ToastContainer />
    </ClientOnly>
  </div>
</template>
