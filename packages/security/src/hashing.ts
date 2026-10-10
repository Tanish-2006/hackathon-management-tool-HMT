import * as argon2 from 'argon2';

/**
 * Argon2id hashing - OWASP recommended settings.
 * MUST be used for all password hashing; bcrypt is deprecated for this project.
 */
export const HASH_OPTIONS: argon2.Options & { type: 2 } = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string') throw new Error('Password must be a string');
  if (plaintext.length < 8) throw new Error('Password too short: minimum 8 characters');
  if (plaintext.length > 128) throw new Error('Password too long: maximum 128 characters');
  return argon2.hash(plaintext, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  if (typeof hash !== 'string' || typeof plaintext !== 'string') return false;
  if (hash.length === 0 || plaintext.length === 0) return false;
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  if (typeof hash !== 'string' || hash.length === 0) return true;
  try {
    return argon2.needsRehash(hash, HASH_OPTIONS);
  } catch {
    // Malformed hash can never be valid — treat as needing rehash so the
    // caller re-hashes on next successful login instead of crashing.
    return true;
  }
}
