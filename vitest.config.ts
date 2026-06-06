import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['contract/**/*.test.ts', 'src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
})
