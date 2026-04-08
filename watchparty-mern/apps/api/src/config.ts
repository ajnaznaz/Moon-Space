import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/watchparty"),
  JWT_SECRET: z.string().min(16).default("watchparty_dev_secret_12345"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  OTT_STANDARD_ACCESS_KEY: z.string().default("MOONSPACE_OTT_STANDARD"),
  OTT_PREMIUM_ACCESS_KEY: z.string().default("MOONSPACE_OTT_PREMIUM")
});

export const env = envSchema.parse(process.env);
