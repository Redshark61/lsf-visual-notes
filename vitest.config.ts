import { defineConfig } from 'vitest/config';

/**
 * Tests de logique pure (géométrie, $Q, schémas, migration) exécutés dans Node.
 * Pour tester des composants Angular, ajouter le builder @angular/build:unit-test.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
