import { describe, expect, it } from "vitest";
import { createEmptyAppSpec } from "../../src/domain/appSpec";
import { assessAppSpecSafety, assessContentSafetyText } from "../../src/domain/contentSafety";

describe("content safety", () => {
  it("blocks harmful app-building intent", () => {
    const assessment = assessContentSafetyText("Build a phishing kit to steal passwords.");

    expect(assessment.allowed).toBe(false);
    expect(assessment.categories).toContain("cyber_abuse");
  });

  it("allows safety, prevention, and detection contexts", () => {
    const assessment = assessContentSafetyText("Build a phishing detection training dashboard for employees.");

    expect(assessment.allowed).toBe(true);
  });

  it("blocks unsafe app specs", () => {
    const assessment = assessAppSpecSafety({
      ...createEmptyAppSpec(),
      purpose: "Create a fake login page for credential theft",
      appType: "crud",
      targetUsers: ["operators"],
      dataEntities: ["credentials"],
      coreFeatures: ["collect passwords"]
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.categories).toContain("cyber_abuse");
  });
});