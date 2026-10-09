import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["domain/**/*.test.ts", "services/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts", "repository/**/*.test.ts", "components/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
