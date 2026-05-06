import { describe, expect, it } from "vitest";
import { MockAppBuilderClient } from "../../src/appBuilder/mockAppBuilderClient";
import type { PartialAppSpec } from "../../src/domain/appSpec";
import type { ConfirmationDecision } from "../../src/domain/confirmation";
import type {
  ClarifyingQuestionInput,
  LlmClient
} from "../../src/llm/llmClient";
import { InMemoryConversationRepository } from "../../src/persistence/inMemoryConversationRepository";
import { handleChatTurn } from "../../src/workflow/handleChatTurn";

class StubLlmClient implements LlmClient {
  constructor(private readonly extractions: PartialAppSpec[]) {}

  async extractAppSpec(): Promise<PartialAppSpec> {
    return this.extractions.shift() ?? {};
  }

  async generateClarifyingQuestion(input: ClarifyingQuestionInput): Promise<string> {
    return `Missing: ${input.missingFields.join(", ")}`;
  }

  async generateConfirmationSummary(): Promise<string> {
    return "Ready to create this app?";
  }

  async classifyConfirmation(): Promise<ConfirmationDecision> {
    return "ambiguous";
  }
}

describe("handleChatTurn", () => {
  it("asks a clarifying question for vague requests", async () => {
    const repository = new InMemoryConversationRepository();
    const appBuilder = new MockAppBuilderClient();
    const llmClient = new StubLlmClient([
      {
        purpose: "sales pipeline",
        appType: "crud",
        dataEntities: ["lead", "deal"]
      }
    ]);

    const response = await handleChatTurn({
      conversationId: "conv_1",
      userId: "user_1",
      message: "Build me a sales app.",
      repository,
      llmClient,
      appBuilder
    });

    expect(response.status).toBe("collecting_requirements");
    expect(response.missingFields).toEqual(["targetUsers", "coreFeatures"]);
    expect(appBuilder.requests).toHaveLength(0);
  });

  it("moves complete requirements to confirmation", async () => {
    const repository = new InMemoryConversationRepository();
    const appBuilder = new MockAppBuilderClient();
    const llmClient = new StubLlmClient([
      {
        purpose: "manage employees",
        appType: "crud",
        targetUsers: ["HR admins"],
        dataEntities: ["employee"],
        coreFeatures: ["create employees", "update employees"]
      }
    ]);

    const response = await handleChatTurn({
      conversationId: "conv_2",
      userId: "user_1",
      message: "Build an employee manager for HR admins.",
      repository,
      llmClient,
      appBuilder
    });

    expect(response.status).toBe("awaiting_confirmation");
    expect(response.message).toBe("Ready to create this app?");
    expect(appBuilder.requests).toHaveLength(0);
  });

  it("creates an app after explicit confirmation", async () => {
    const repository = new InMemoryConversationRepository();
    const appBuilder = new MockAppBuilderClient();
    const llmClient = new StubLlmClient([
      {
        purpose: "manage employees",
        appType: "crud",
        targetUsers: ["HR admins"],
        dataEntities: ["employee"],
        coreFeatures: ["create employees", "update employees"]
      }
    ]);

    await handleChatTurn({
      conversationId: "conv_3",
      userId: "user_1",
      message: "Build an employee manager for HR admins.",
      repository,
      llmClient,
      appBuilder
    });

    const response = await handleChatTurn({
      conversationId: "conv_3",
      userId: "user_1",
      message: "yes",
      repository,
      llmClient,
      appBuilder
    });

    expect(response.status).toBe("created");
    expect(response.createdApp?.appId).toBe("app_mock_1");
    expect(appBuilder.requests).toHaveLength(1);
  });

  it("returns to collection when confirmation is declined", async () => {
    const repository = new InMemoryConversationRepository();
    const appBuilder = new MockAppBuilderClient();
    const llmClient = new StubLlmClient([
      {
        purpose: "manage employees",
        appType: "crud",
        targetUsers: ["HR admins"],
        dataEntities: ["employee"],
        coreFeatures: ["create employees", "update employees"]
      }
    ]);

    await handleChatTurn({
      conversationId: "conv_4",
      userId: "user_1",
      message: "Build an employee manager for HR admins.",
      repository,
      llmClient,
      appBuilder
    });

    const response = await handleChatTurn({
      conversationId: "conv_4",
      userId: "user_1",
      message: "no",
      repository,
      llmClient,
      appBuilder
    });

    expect(response.status).toBe("collecting_requirements");
    expect(appBuilder.requests).toHaveLength(0);
  });
});
