import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().min(1).default("127.0.0.1"),
  databasePath: z.string().default("data/agentcloak.db"),
  databaseEncryptionKey: z.string().optional(),
  googleClientId: z.string().min(1).optional(),
  googleClientSecret: z.string().min(1).optional(),
  googleRedirectUri: z.string().url().optional(),
  gmailAllowDrafts: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  gmailAllowMarkRead: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  baseUrl: z.string().url(),
  sessionSecret: z.string().min(32).refine(
    (secret) => secret !== "change-me-to-a-random-string-at-least-32-chars",
    "Generate a unique SESSION_SECRET with openssl rand -hex 32",
  ),
  sessionMaxAge: z.coerce.number().default(7 * 24 * 60 * 60 * 1000), // 7 days
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    port: process.env.PORT,
    host: process.env.HOST,
    databasePath: process.env.DATABASE_PATH,
    databaseEncryptionKey: process.env.DATABASE_ENCRYPTION_KEY,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    gmailAllowDrafts: process.env.GMAIL_ALLOW_DRAFTS,
    gmailAllowMarkRead: process.env.GMAIL_ALLOW_MARK_READ,
    baseUrl: process.env.BASE_URL,
    sessionSecret: process.env.SESSION_SECRET,
    sessionMaxAge: process.env.SESSION_MAX_AGE,
  });
}

export function isGoogleOAuthConfigured(config: Config): boolean {
  return !!(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
}
