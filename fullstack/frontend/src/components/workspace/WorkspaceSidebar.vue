<script setup>
defineProps({
  user: {
    type: Object,
    default: null
  },
  role: {
    type: String,
    default: ""
  },
  panels: {
    type: Array,
    default: () => []
  },
  activePanel: {
    type: String,
    default: "overview"
  }
});

const emit = defineEmits(["update:active-panel", "logout"]);
</script>

<template>
  <aside class="workspace-nav">
    <h2>ForgeOps Hub</h2>
    <p>{{ user?.username }} | {{ role }}</p>
    <button
      v-for="panel in panels"
      :key="panel"
      @click="emit('update:active-panel', panel)"
      :class="{ active: activePanel === panel }"
    >
      {{ panel }}
    </button>
    <button class="logout" @click="emit('logout')">Logout</button>
  </aside>
</template>
