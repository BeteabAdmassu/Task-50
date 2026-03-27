<script setup>
defineProps({
  widgets: {
    type: Object,
    default: () => ({})
  }
});
</script>

<template>
  <article class="card">
    <h3>Quick stats</h3>
    <pre>{{ widgets }}</pre>
  </article>
</template>
