import { z } from "zod";

export function parseJsonWithSchema<T>(text: string, schema: z.ZodType<T>): T {
  const jsonText = extractJsonObject(text);
  const parsed: unknown = JSON.parse(jsonText);
  return schema.parse(parsed);
}

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("No JSON object found in LLM response.");
}
