import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: 'manifest.json', // ★ここが重要（dist/manifest.jsonに出る）
    rollupOptions: {
      input: ['/client-entry.tsx'],
    },
  },
});

