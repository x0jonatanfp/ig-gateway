import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/index.ts',
        'src/cli/index.ts',
        'src/http/server.ts',
        'src/domain/Publication.ts',
        'src/domain/ports.ts',
        'src/application/memory.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 90,
        'src/domain/**': { lines: 95, branches: 90 },
        'src/application/**': { lines: 95, branches: 90 },
        'src/infrastructure/**': { lines: 90, branches: 85 },
        'src/http/app.ts': { lines: 85 },
        'src/cli/**': { lines: 85 },
      },
    },
  },
});
