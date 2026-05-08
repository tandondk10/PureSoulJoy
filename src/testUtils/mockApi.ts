import type { BackendResponse } from "../contracts/backendResponse";

export async function mockQueryApi(response: BackendResponse): Promise<BackendResponse> {
  return Promise.resolve(response);
}

export async function mockFailedQueryApi(): Promise<BackendResponse> {
  throw new Error("Network failed");
}
