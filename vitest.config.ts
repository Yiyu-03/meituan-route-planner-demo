import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['contract/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['src/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
