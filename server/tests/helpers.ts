import { clearDbSingleton } from '../src/db/index.js';

/**
 * Reset the DB singleton so each test gets a fresh migration+seed
 * against the isolated per-test data dir.
 */
export function resetDbForTest(): void {
  clearDbSingleton();
}
