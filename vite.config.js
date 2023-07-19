import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: "./index.html",
        login: "./login.html",
        manage: "./manage.html"
      },
    },
  }
});