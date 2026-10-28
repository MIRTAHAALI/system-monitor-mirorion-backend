import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const CREDENTIALS_FILE = path.join(process.cwd(), 'data', '.credentials.json');
const JWT_SECRET_FILE = path.join(process.cwd(), 'data', '.jwt_secret');

export interface StoredCredentials {
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface AuthConfig {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}

const MIN_PASSWORD_LENGTH = 8;

function ensureDataDir(): void {
  const dir = path.dirname(CREDENTIALS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/** Writes a secret file that is owner-only from the moment it exists. */
function writeSecretFile(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents, { encoding: 'utf-8', mode: 0o600 });
  // writeFileSync keeps the mode of an existing file, so tighten it explicitly too.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows doesn't support chmod the same way
  }
}

function loadCredentials(): StoredCredentials | null {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // corrupted file
  }
  return null;
}

function saveCredentials(creds: StoredCredentials): void {
  ensureDataDir();
  writeSecretFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

function getOrCreateJwtSecret(): string {
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const existing = fs.readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
      // An empty or truncated secret would make tokens trivially forgeable.
      if (existing.length >= 32) return existing;
    }
  } catch {
    // generate new
  }
  ensureDataDir();
  const secret = crypto.randomBytes(64).toString('hex');
  writeSecretFile(JWT_SECRET_FILE, secret);
  return secret;
}

function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Print the prompt, then swallow readline's echo of every keystroke.
    let muted = false;
    const internal = rl as unknown as { _writeToOutput: (chunk: string) => void };
    internal._writeToOutput = (chunk: string) => {
      if (!muted || chunk.includes('\n') || chunk.includes('\r')) {
        process.stdout.write(muted ? '\n' : chunk);
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    muted = true;
  });
}

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const MIN_JWT_SECRET_LENGTH = 32;

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Reads the JWT signing secret from JWT_SECRET when set, so tokens survive restarts in
 * environments where data/ is not persisted (e.g. containers).
 */
function jwtSecretFromEnv(): string | undefined {
  const secret = envValue('JWT_SECRET');
  if (secret === undefined) return undefined;
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  return secret;
}

/**
 * Reads credentials from ADMIN_USERNAME plus ADMIN_PASSWORD_HASH (preferred) or
 * ADMIN_PASSWORD. Returns null when none are set, so the file/prompt flow is used instead.
 */
async function credentialsFromEnv(): Promise<{ username: string; passwordHash: string } | null> {
  const username = envValue('ADMIN_USERNAME');
  const passwordHash = envValue('ADMIN_PASSWORD_HASH');
  const password = envValue('ADMIN_PASSWORD');

  if (!username && !passwordHash && !password) return null;
  if (!username) {
    throw new Error('ADMIN_USERNAME is required when ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is set');
  }
  if (passwordHash && password) {
    throw new Error('Set only one of ADMIN_PASSWORD_HASH or ADMIN_PASSWORD, not both');
  }
  if (passwordHash) {
    if (!BCRYPT_HASH_PATTERN.test(passwordHash)) {
      throw new Error('ADMIN_PASSWORD_HASH is not a valid bcrypt hash (generate one with `npm run hash-password`)');
    }
    return { username, passwordHash };
  }
  if (!password) {
    throw new Error('ADMIN_PASSWORD_HASH or ADMIN_PASSWORD is required when ADMIN_USERNAME is set');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return { username, passwordHash: await bcrypt.hash(password, 12) };
}

export async function promptForCredentials(forceNew = false): Promise<AuthConfig> {
  const jwtSecret = jwtSecretFromEnv() ?? getOrCreateJwtSecret();

  // Environment credentials take precedence and are never written to disk.
  const fromEnv = await credentialsFromEnv();
  if (fromEnv) {
    console.log(`\n✅ Loaded credentials from environment for user: ${fromEnv.username}`);
    return { ...fromEnv, jwtSecret };
  }

  const existing = loadCredentials();

  if (existing && !forceNew) {
    console.log(`\n✅ Loaded existing credentials for user: ${existing.username}`);
    return {
      username: existing.username,
      passwordHash: existing.passwordHash,
      jwtSecret,
    };
  }

  console.log('\n🔐 ==========================================');
  console.log('   System Monitor — Initial Setup');
  console.log('   Please create your admin credentials.');
  console.log('   ==========================================\n');

  let username = '';
  let password = '';
  let confirmPassword = '';

  while (!username) {
    username = await promptUser('   Username: ');
    if (!username) console.log('   ⚠ Username cannot be empty.');
  }

  while (true) {
    password = await promptHidden('   Password: ');
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.log(`   ⚠ Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      continue;
    }
    confirmPassword = await promptHidden('   Confirm password: ');
    if (password !== confirmPassword) {
      console.log('   ⚠ Passwords do not match. Try again.');
      continue;
    }
    break;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const creds: StoredCredentials = {
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  saveCredentials(creds);
  console.log(`\n✅ Credentials saved for user: ${username}`);
  console.log('   credentials stored in data/.credentials.json\n');

  return { username, passwordHash, jwtSecret };
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
