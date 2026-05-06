import type { AppConfig } from "../config";

export function createLoggerOptions(config: AppConfig) {
  return { level: config.logLevel };
}
