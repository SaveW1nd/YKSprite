import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    entry: resolve(__dirname, "./src/main.ts"),
    build: {
      outDir: "dist-electron/main",
      rollupOptions: {
        input: resolve(__dirname, "./src/main.ts"),
        output: {
          format: "cjs",
          entryFileNames: "index.js"
        }
      }
    }
  },
  preload: {
    input: {
      index: resolve(__dirname, "./src/preload.ts")
    },
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        input: resolve(__dirname, "./src/preload.ts"),
        output: {
          format: "cjs",
          entryFileNames: "preload.js"
        }
      }
    }
  }
});
