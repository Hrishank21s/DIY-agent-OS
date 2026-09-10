import { config } from '../config.js';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDb } from '../db/index.js';
import { resetBootstrapUser } from '../db/seed.js';

const PID_FILE = path.join(config.dataDir, 'agentos.pid');
const LOG_FILE = path.join(config.dataDir, 'agentos.log');

export async function cliStart(): Promise<void> {
  return new Promise(resolve => {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
      if (isRunning(pid)) {
        console.log(`AgentOS already running (PID ${pid}).`);
        resolve();
        return;
      }
      fs.unlinkSync(PID_FILE);
    }

    const entry = path.join(import.meta.dirname, '..', 'index.js');
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
      env: { ...process.env },
    });
    child.unref();
    child.on('spawn', () => {
      fs.writeFileSync(PID_FILE, String(child.pid));
      console.log(`AgentOS started (PID ${child.pid}). Log: ${LOG_FILE}`);
      resolve();
    });
    child.on('error', err => {
      console.error('Failed to start:', err.message);
      resolve();
    });
  });
}

export async function cliStop(): Promise<void> {
  if (!fs.existsSync(PID_FILE)) {
    console.log('AgentOS is not running.');
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to PID ${pid}.`);
  } catch {
    console.log(`PID ${pid} not running; removing stale pid file.`);
  }
  fs.unlinkSync(PID_FILE);
}

export function cliStatus(): void {
  let pid: number | null = null;
  if (fs.existsSync(PID_FILE)) {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
  }
  const running = pid ? isRunning(pid) : false;
  console.log(running ? `AgentOS: RUNNING (PID ${pid})` : 'AgentOS: NOT RUNNING');
  const port = config.port;
  console.log(`URL: http://localhost:${port}`);
  console.log(`LAN: http://0.0.0.0:${port}`);
  console.log(`Data dir: ${config.dataDir}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cliDoctor(): Promise<number> {
  console.log('=== AgentOS Doctor ===\n');
  let ok = true;

  // Node
  const node = process.version;
  console.log(`✓ Node: ${node}`);
  if (parseInt(node.replace('v', '').split('.')[0], 10) < 20) {
    console.log('  ✗ Node >= 20 recommended');
    ok = false;
  }

  // SQLite via node:sqlite
  try {
    const d = getDb();
    d.db.prepare('SELECT 1').get();
    console.log('✓ SQLite: OK (node:sqlite)');
    d.close();
  } catch (e) {
    console.log(`✗ SQLite: FAILED - ${(e as Error).message}`);
    ok = false;
  }

  // OpenCode executable
  try {
    const out = runCmd(config.opencodePath, ['--version']);
    console.log(`✓ OpenCode: ${out.trim()}`);
  } catch {
    console.log(`✗ OpenCode: not found at '${config.opencodePath}'`);
    console.log('  Set AGENTOS_OPENCODE_PATH or the Settings > OpenCode path.');
    ok = false;
  }

  // Config working dir
  const wd = config.defaultWorkingDir;
  if (fs.existsSync(wd)) {
    console.log(`✓ Working dir: ${wd}`);
  } else {
    console.log(`✗ Working dir does not exist: ${wd}`);
    ok = false;
  }

  // Data dir writable
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const test = path.join(config.dataDir, '.write-test');
    fs.writeFileSync(test, 'ok');
    fs.unlinkSync(test);
    console.log(`✓ Data dir writable: ${config.dataDir}`);
  } catch {
    console.log(`✗ Data dir not writable: ${config.dataDir}`);
    ok = false;
  }

  // Network binding check (port open?)
  const net = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${config.port}, '0.0.0.0', () => { console.log('BIND_OK'); process.exit(0); }).on('error', () => { console.log('BIND_FAIL'); process.exit(1); })`], { stdio: 'pipe' });
  let netOut = '';
  net.stdout?.on('data', d => (netOut += d.toString()));
  return new Promise<number>(res => {
    net.on('close', _code => {
      if (netOut.includes('BIND_OK')) {
        console.log(`✓ Network: 0.0.0.0:${config.port} bindable`);
      } else {
        console.log(`✗ Network: cannot bind 0.0.0.0:${config.port} (in use?)`);
        ok = false;
      }
      // launchd
      const plist = launchdPlistPath();
      if (fs.existsSync(plist)) {
        console.log(`✓ launchd plist installed: ${plist}`);
      } else {
        console.log(`○ launchd plist not installed (run scripts/install-launchd.sh)`);
      }

      console.log(ok ? '\nDoctor: ALL CHECKS PASSED' : '\nDoctor: ISSUES FOUND');
      res(ok ? 0 : 1);
    });
  });
}

function runCmd(cmd: string, args: string[]): string {
  return execSync(`"${cmd}" ${args.map(a => `"${escapeArg(a)}"`).join(' ')}`, { encoding: 'utf-8', timeout: 20000 });
}

function escapeArg(a: string): string {
  return a.replace(/"/g, '\\"');
}

const LAUNCHD_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
export function plistPath(): string {
  return path.join(LAUNCHD_DIR, 'com.agentos.server.plist');
}

function launchdPlistPath(): string {
  return plistPath();
}

export function cliMigrate(): void {
  const d = getDb();
  console.log('Migrations applied.');
  d.close();
}

export function cliResetAdmin(): void {
  const d = getDb();
  resetBootstrapUser(d);
  console.log('Admin password reset to the configured bootstrap credentials. A password change will be required on next login.');
  d.close();
}

export function cliLogs(limit = 100): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No log file yet.');
    return;
  }
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  const start = Math.max(0, lines.length - limit);
  console.log(lines.slice(start).join('\n'));
}

export { PID_FILE, LOG_FILE };
