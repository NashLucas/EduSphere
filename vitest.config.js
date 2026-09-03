import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Both locations declared in TRD §3.4: co-located module tests under
    // src/modules/*/tests/, and the top-level tests/ tree. The scaffolded
    // pattern covered only the former, so every integration spec would have
    // been committed, reported green, and never executed.
    include: ['src/**/*.test.js', 'tests/{unit,integration}/**/*.test.js'],
    globalSetup: ['./tests/global-setup.js'],
    setupFiles: ['./tests/integration/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/config/', 'src/database/migrations/'],
    },
  },
});
