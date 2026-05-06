import type { AppBuilderClient, CreateAppRequest, CreateAppResult } from "./appBuilderClient";

export class MockAppBuilderClient implements AppBuilderClient {
  private counter = 0;
  readonly requests: CreateAppRequest[] = [];

  async createApp(request: CreateAppRequest): Promise<CreateAppResult> {
    this.counter += 1;
    this.requests.push(structuredClone(request));

    const appId = `app_mock_${this.counter}`;
    return {
      status: "created",
      appId,
      url: `http://localhost:3000/apps/${appId}`
    };
  }
}
