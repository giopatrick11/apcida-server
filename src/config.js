export function loadConfig(env = process.env) {
  const apiKey = env.REPORT_API_KEY;
  const databaseUrl = env.DATABASE_URL;
  const port = Number(env.PORT ?? 3000);

  if (!apiKey || apiKey.length < 32) {
    throw new Error('REPORT_API_KEY must contain at least 32 characters');
  }
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  const adminValues = [env.ADMIN_USERNAME, env.ADMIN_PASSWORD_HASH, env.ADMIN_SESSION_SECRET];
  const adminEnabled = adminValues.some(Boolean);
  if (adminEnabled && (!adminValues.every(Boolean) || env.ADMIN_SESSION_SECRET.length < 32 ||
      !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH))) {
    throw new Error('Admin requires ADMIN_USERNAME, a scrypt ADMIN_PASSWORD_HASH, and ADMIN_SESSION_SECRET of at least 32 characters');
  }

  return { apiKey, databaseUrl, port, admin: adminEnabled ? {
    username: env.ADMIN_USERNAME, passwordHash: env.ADMIN_PASSWORD_HASH,
    sessionSecret: env.ADMIN_SESSION_SECRET
  } : null };
}
