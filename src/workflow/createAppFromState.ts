import type { AppBuilderClient, CreateAppResult } from "../appBuilder/appBuilderClient";
import type { ConversationState } from "../domain/conversationState";
import { getMissingFields } from "../domain/validation";

export async function createAppFromState(state: ConversationState, appBuilder: AppBuilderClient): Promise<CreateAppResult> {
  const missingFields = getMissingFields(state.appSpec);
  if (missingFields.length > 0) {
    throw new Error(`Cannot create app with missing fields: ${missingFields.join(", ")}`);
  }

  return appBuilder.createApp({
    conversationId: state.conversationId,
    requestedBy: state.userId ?? null,
    appSpec: state.appSpec
  });
}
