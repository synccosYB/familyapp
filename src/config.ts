// All configuration comes from environment variables (deploy/site.env + generated secrets on the box).
const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v == null || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const int = (v: string | undefined, d: number) => (v ? parseInt(v, 10) || d : d);

export const config = {
  port: int(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || 'postgres://familye:familye@127.0.0.1:5432/familye',
  dbPoolMax: int(env.DATABASE_POOL_MAX, 5),
  dataDir: env.FAMILYE_DATA || './data',
  cookieSecure: bool(env.COOKIE_SECURE, false),
  trustProxy: bool(env.TRUST_PROXY, true),
  sessionDays: int(env.SESSION_DAYS, 90),
  uploadMaxMb: int(env.UPLOAD_MAX_MB, 10),
  logLevel: env.LOG_LEVEL || 'info',
  timezone: env.FAMILY_TZ || 'America/New_York',
  learningReminderHour: Math.max(0, Math.min(23, Number.isFinite(Number(env.LEARNING_REMINDER_HOUR)) && env.LEARNING_REMINDER_HOUR !== '' ? Number(env.LEARNING_REMINDER_HOUR) : 9)),
  pgDumpBin: env.PG_DUMP_BIN || 'pg_dump',
  resendApiKey: env.RESEND_API_KEY || '',
  resendFromEmail: env.RESEND_FROM_EMAIL || '',
  wordingSyncToken: env.KOBOR_WORDING_SYNC_TOKEN || '',
  // first admin, created by bootstrap if missing
  admin: {
    name: env.ADMIN_NAME || '',
    phone: env.ADMIN_PHONE || '',
    email: env.ADMIN_EMAIL || '',
    setupTokenSha256: env.SETUP_TOKEN_SHA256 || '',
    setupTokenDays: int(env.SETUP_TOKEN_DAYS, 14),
  },
  // first-boot family names (afterwards the admin edits them in the app)
  family: {
    yi: env.FAMILY_YI || '', en: env.FAMILY_EN || '',
    aYi: env.SIDE_A_FAMILY_YI || '', aEn: env.SIDE_A_FAMILY_EN || '',
    bYi: env.SIDE_B_FAMILY_YI || '', bEn: env.SIDE_B_FAMILY_EN || '',
  },
  // temporary QA mode (deploy/qa.env, never committed): sign-ups whose phone starts with this prefix are test users
  qaPhonePrefix: env.QA_PHONE_PREFIX || '',
};
