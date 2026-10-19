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

  return { apiKey, databaseUrl, port };
}
