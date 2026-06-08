import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          include: ["tests/client/**/*.test.{ts,tsx}"]
        }
      },
      {
        test: {
          name: "worker",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/client/**"]
        }
      }
    ]
  }
});
