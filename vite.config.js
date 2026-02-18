import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
    allowedHosts: ["8cb7-2409-40d2-12b3-de30-9fc-1752-f0a7-116.ngrok-free.app"],
  },
});
