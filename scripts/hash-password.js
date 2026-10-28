#!/usr/bin/env node
// Prints a bcrypt hash for ADMIN_PASSWORD_HASH. The password is read from a hidden prompt
// so it never lands in shell history.
const readline = require('readline');
const bcrypt = require('bcrypt');

const MIN_PASSWORD_LENGTH = 8;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
rl._writeToOutput = (chunk) => {
  if (!muted || chunk.includes('\n') || chunk.includes('\r')) {
    process.stdout.write(muted ? '\n' : chunk);
  }
};

rl.question('Password: ', async (answer) => {
  rl.close();
  const password = answer.trim();
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log(`\nADMIN_PASSWORD_HASH=${hash}`);
});
muted = true;
