import { describe, expect, it } from "vitest";
import { classifyConfirmationDeterministically } from "../../src/domain/confirmation";

describe("classifyConfirmationDeterministically", () => {
  it("detects yes replies", () => {
    expect(classifyConfirmationDeterministically("yes")).toBe("yes");
    expect(classifyConfirmationDeterministically("build it")).toBe("yes");
  });

  it("detects no replies", () => {
    expect(classifyConfirmationDeterministically("no")).toBe("no");
    expect(classifyConfirmationDeterministically("make changes")).toBe("no");
  });

  it("returns ambiguous for unclear replies", () => {
    expect(classifyConfirmationDeterministically("maybe after one more change")).toBe("ambiguous");
  });
});
