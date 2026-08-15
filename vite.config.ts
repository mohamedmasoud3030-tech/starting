import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

function manualChunks(id: string) {
  if (!id.includes("/node_modules/")) return undefined;

  if (
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/scheduler/")
  ) {
    return "react-vendor";
  }

  if (id.includes("/node_modules/@tanstack/")) return "tanstack-vendor";
  if (id.includes("/node_modules/@supabase/")) return "supabase-vendor";
  if (id.includes("/node_modules/@radix-ui/")) return "radix-vendor";
  if (id.includes("/node_modules/lucide-react/")) return "icons-vendor";

  return "vendor";
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
});
