// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// https://astro.build/config
export default defineConfig({
  site: process.env.APP_URL || 'https://stdout.seayniclabs.com',
  output: 'server',
  security: {
    checkOrigin: false, // Custom origin check in middleware (proxy chain sees HTTP, not HTTPS)
  },
  integrations: [sitemap()],
  adapter: node({
    mode: 'standalone',
  }),
  vite: {
    define: {
      'import.meta.env.STDOUT_VERSION': JSON.stringify(pkg.version),
    },
  },
});
