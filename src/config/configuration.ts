export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  demoMode: process.env.DEMO_MODE === 'true',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3001').split(','),

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  retell: {
    apiKey: process.env.RETELL_API_KEY,
    webhookSecret: process.env.RETELL_WEBHOOK_SECRET,
    agentId: process.env.RETELL_AGENT_ID,
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
  },

  // SMTP / nodemailer (Gmail by default). The Gmail "App Password" goes into
  // SMTP_PASS — NEVER a real Google account password.
  smtp: {
    service: process.env.SMTP_SERVICE || 'gmail',
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@ringr.ca',
  },

  // Base URL the portal serves the "accept-invite" page on. Used by the email
  // template to build the magic-link URL. The token is appended as a path param.
  portal: {
    baseUrl: process.env.PORTAL_BASE_URL || 'http://localhost:3001',
    inviteAcceptPath: process.env.PORTAL_INVITE_PATH || '/accept-invite',
  },

  magicLink: {
    // 7 days — onboarding emails often get opened late.
    expirySeconds: parseInt(process.env.MAGIC_LINK_EXPIRY_SECONDS, 10) || 7 * 24 * 60 * 60,
  },

  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
});
