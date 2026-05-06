import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const configSchema = z.object({
  awsRegion: z.string().min(1).default("us-east-1"),
  bedrockModelId: z.string().min(1).default("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
  bedrockMaxTokens: z.coerce.number().int().positive().default(1200),
  bedrockTemperature: z.coerce.number().min(0).max(1).default(0),
  port: z.coerce.number().int().positive().default(3000),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    awsRegion: env.AWS_REGION,
    bedrockModelId: env.BEDROCK_MODEL_ID,
    bedrockMaxTokens: env.BEDROCK_MAX_TOKENS,
    bedrockTemperature: env.BEDROCK_TEMPERATURE,
    port: env.PORT,
    logLevel: env.LOG_LEVEL
  });
}
