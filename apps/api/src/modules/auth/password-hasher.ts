import { Injectable } from '@nestjs/common';
import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Argon2id password hashing via a vetted native implementation — no custom cryptography.
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum for Argon2id
 * (m = 19 MiB, t = 2, p = 1). The encoded hash string carries salt and parameters, so
 * parameters can be raised later without invalidating existing hashes.
 */
const ARGON2ID_OPTIONS: Options = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2ID_OPTIONS);
  }

  async verify(encodedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(encodedHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Performs a full verification against a throwaway hash. Used when the account does not exist
   * so that response timing does not reveal which email addresses are registered.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= hash('smarttag-timing-equalizer', ARGON2ID_OPTIONS);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
