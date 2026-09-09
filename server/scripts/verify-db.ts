import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

const d = getDb();
seed(d);
console.log('users:', d.db.prepare('SELECT username, must_change_password FROM users').all());
console.log('agents:', d.db.prepare('SELECT name FROM agents').all());
console.log('perms for General:', d.db.prepare("SELECT resource, action, allowed FROM agent_permissions ap JOIN agents a ON a.id=ap.agent_id WHERE a.name='General'").all());
console.log('settings count:', d.db.prepare('SELECT COUNT(*) c FROM settings').get());

const h = hashPassword('secret123');
console.log('hash ok:', h.startsWith('scrypt$'), 'verify:', verifyPassword(h, 'secret123'), verifyPassword(h, 'wrong') === false);

d.close();
console.log('DB VERIFY OK');
