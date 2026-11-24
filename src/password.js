import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const [salt, stored] = encoded?.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
  const hash = await derive(password, salt, 64);
  return timingSafeEqual(hash, Buffer.from(stored, 'hex')) && Boolean(encoded);
}
