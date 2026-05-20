import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/lib/db/central-schema.ts', './src/lib/db/tenant-schema.ts'],
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/stdout.db',
  },
});
