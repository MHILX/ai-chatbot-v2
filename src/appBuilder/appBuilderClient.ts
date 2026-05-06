import type { AppSpec } from "../domain/appSpec";

export interface CreateAppRequest {
  conversationId: string;
  requestedBy: string | null;
  appSpec: AppSpec;
}

export interface CreateAppResult {
  status: "created";
  appId: string;
  url: string;
}

export interface AppBuilderClient {
  createApp(request: CreateAppRequest): Promise<CreateAppResult>;
}
