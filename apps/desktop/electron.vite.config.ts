import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    entry: resolve(__dirname, "./src/main.ts")
  },
  preload: {
    input: {
      index: resolve(__dirname, "./src/preload.ts")
    }
  }
});
