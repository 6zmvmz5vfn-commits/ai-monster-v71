import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gatewayUrl = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: gatewayUrl,
        changeOrigin: true,
      },
      "/market": {
        target: `ws://${new URL(gatewayUrl).host}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
