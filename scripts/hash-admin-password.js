import { hashPassword } from '../src/admin-auth.js';

const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD to a password of at least 12 characters.');
  process.exitCode = 1;
} else {
  console.log(hashPassword(password));
}
