import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonObject, parseJsonWithSchema } from "../../src/llm/structuredJson";

describe("structured JSON helpers", () => {
  it("extracts fenced JSON", () => {
    expect(extractJsonObject("```json\n{\"a\":1}\n```")).toBe("{\"a\":1}");
  });

  it("validates parsed JSON with a schema", () => {
    const schema = z.object({ value: z.string() });
    expect(parseJsonWithSchema('{"value":"ok"}', schema)).toEqual({ value: "ok" });
  });
});
