import { describe, expect, it } from "vitest";
import { createEmptyAppSpec } from "../../src/domain/appSpec";
import { mergeAppSpec } from "../../src/domain/mergeAppSpec";

describe("mergeAppSpec", () => {
  it("preserves existing scalar values when extracted values are empty", () => {
    const existing = {
      ...createEmptyAppSpec(),
      purpose: "manage employees",
      appType: "crud" as const
    };

    expect(mergeAppSpec(existing, { purpose: null }).purpose).toBe("manage employees");
  });

  it("applies non-empty scalar corrections", () => {
    const existing = {
      ...createEmptyAppSpec(),
      purpose: "manage employees",
      appType: "crud" as const
    };

    const merged = mergeAppSpec(existing, { purpose: "manage contractors" });
    expect(merged.purpose).toBe("manage contractors");
  });

  it("deduplicates list fields case-insensitively", () => {
    const existing = {
      ...createEmptyAppSpec(),
      targetUsers: ["HR admins"]
    };

    const merged = mergeAppSpec(existing, { targetUsers: ["hr admins", "Managers"] });
    expect(merged.targetUsers).toEqual(["HR admins", "Managers"]);
  });
});
