import { describe, expect, it } from "vitest";
import { normalizeAssistantText } from "../../src/llm/textOutput";

describe("normalizeAssistantText", () => {
  it("removes common markdown decoration", () => {
    const text = normalizeAssistantText("# Title\n\n- **Question:** What should it track?");
    expect(text).toBe("Title\n\nQuestion: What should it track?");
  });
});
