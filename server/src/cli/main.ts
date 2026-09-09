import { cliStart, cliStop, cliStatus, cliDoctor, cliMigrate, cliResetAdmin, cliLogs } from './index.js';

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case 'start':
      await cliStart();
      break;
    case 'stop':
      await cliStop();
      break;
    case 'status':
      cliStatus();
      break;
    case 'doctor':
      process.exit(await cliDoctor());
      break;
    case 'migrate':
      cliMigrate();
      break;
    case 'reset-admin':
      cliResetAdmin();
      break;
    case 'logs':
      cliLogs(parseInt(process.argv[3] || '100', 10));
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      console.log(`AgentOS CLI

Usage: agentos <command>

Commands:
  start         Start AgentOS as a background daemon
  stop          Stop the AgentOS daemon
  status        Show running status
  doctor        Run health and dependency checks
  migrate       Apply database migrations
  reset-admin   Reset the admin password to bootstrap credentials
  logs [N]      Show the last N lines of the server log
  help          Show this help
`);
      break;
  }
}

void main();
