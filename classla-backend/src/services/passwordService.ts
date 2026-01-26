import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export class PasswordService {
  /**
   * Hash a password using bcrypt
   * @param password - The plaintext password to hash
   * @returns The hashed password
   */
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify a password against a hash
   * @param password - The plaintext password to verify
   * @param hash - The bcrypt hash to compare against
   * @returns True if password matches, false otherwise
   */
  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a random temporary password
   * @param length - Length of the password (default 12)
   * @returns A random password string
   */
  generateTemporaryPassword(length: number = 12): string {
    // Use characters that are easy to read (no ambiguous chars like 0/O, 1/l/I)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Validate password strength
   * @param password - The password to validate
   * @returns Validation result with valid flag and optional message
   */
  validatePasswordStrength(password: string): { valid: boolean; message?: string } {
    if (!password) {
      return { valid: false, message: 'Password is required' };
    }
    if (password.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters' };
    }
    if (password.length > 128) {
      return { valid: false, message: 'Password must be less than 128 characters' };
    }
    return { valid: true };
  }

  /**
   * Validate username format
   * @param username - The username to validate
   * @returns Validation result with valid flag and optional message
   */
  validateUsername(username: string): { valid: boolean; message?: string } {
    if (!username) {
      return { valid: false, message: 'Username is required' };
    }
    if (username.length < 3) {
      return { valid: false, message: 'Username must be at least 3 characters' };
    }
    if (username.length > 30) {
      return { valid: false, message: 'Username must be less than 30 characters' };
    }
    // Only allow alphanumeric and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return { valid: false, message: 'Username can only contain letters, numbers, and underscores' };
    }
    // Must not look like an email
    if (username.includes('@')) {
      return { valid: false, message: 'Username cannot contain @ symbol' };
    }
    return { valid: true };
  }
}

// Singleton instance
export const passwordService = new PasswordService();

export default passwordService;
