import { describe, expect, it } from "vitest";
import { createEmptyAppSpec } from "../../src/domain/appSpec";
import { createUserPreferences, mergeUserPreferencesFromAppSpec } from "../../src/domain/userPreferences";

describe("user preferences", () => {
  it("tracks reusable preferences from app specs", () => {
    const preferences = createUserPreferences("user_1", "2026-05-18T00:00:00.000Z");

    const updated = mergeUserPreferencesFromAppSpec(preferences, {
      ...createEmptyAppSpec(),
      appType: "crud",
      deploymentTarget: "web",
      authRequired: true,
      integrations: ["Google auth", "google auth", "Slack"]
    });

    expect(updated).toMatchObject({
      userId: "user_1",
      preferredAppType: "crud",
      preferredDeploymentTarget: "web",
      preferredAuthRequired: true,
      preferredIntegrations: ["Google auth", "Slack"]
    });
  });
});