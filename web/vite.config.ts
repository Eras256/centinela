import { defineConfig } from "vite";

// GitHub Pages serves a project page (not a custom domain) at
// https://eras256.github.io/centinela/, so asset URLs need that path
// prefix. Vercel/other static hosts serve from "/", so the base can be
// overridden with BASE_PATH at build time if this ever moves there.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/centinela/",
});
