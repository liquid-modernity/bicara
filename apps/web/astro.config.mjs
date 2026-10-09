import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  security: {
    csp: true
  },
  build: {
    inlineStylesheets: 'auto'
  },
  vite: {
    build: {
      target: 'es2022'
    }
  }
});
