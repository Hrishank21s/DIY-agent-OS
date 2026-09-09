import { getDb, clearDbSingleton } from './index.js';

export function runMigrations(): void {
  clearDbSingleton();
  getDb();
  console.log('Migrations applied successfully.');
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations();
}
