import { describe, expect, it } from "vitest";
import { createEmptyAppSpec } from "../../src/domain/appSpec";
import { getMissingFields, isReadyToBuild } from "../../src/domain/validation";

describe("getMissingFields", () => {
  it("requires app type and purpose for an empty spec", () => {
    expect(getMissingFields(createEmptyAppSpec())).toEqual(["appType", "purpose"]);
  });

  it("requires CRUD app fields", () => {
    const spec = {
      ...createEmptyAppSpec(),
      appType: "crud" as const,
      purpose: "manage employees"
    };

    expect(getMissingFields(spec)).toEqual(["targetUsers", "dataEntities", "coreFeatures"]);
  });

  it("treats false boolean fields as present", () => {
    const spec = {
      ...createEmptyAppSpec(),
      appType: "portal" as const,
      purpose: "share project updates",
      targetUsers: ["customers"],
      coreFeatures: ["view project status"],
      authRequired: false
    };

    expect(getMissingFields(spec)).toEqual([]);
    expect(isReadyToBuild(spec)).toBe(true);
  });
});
