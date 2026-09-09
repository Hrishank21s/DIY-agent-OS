import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
const PREFIX = 'scrypt$';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptPassword(password, salt);
  return `${PREFIX}${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function scryptPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS);
}

export function verifyPassword(hash: string, password: string): boolean {
  try {
    const parts = hash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, Nstr, rstr, pstr, saltB64, hashB64] = parts;
    const N = parseInt(Nstr, 10);
    const r = parseInt(rstr, 10);
    const p = parseInt(pstr, 10);
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const maxmem = N * r * 128 * 2;
    const actual = Buffer.from(scryptSync(password, salt, expected.length, { N, r, p, maxmem }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}
