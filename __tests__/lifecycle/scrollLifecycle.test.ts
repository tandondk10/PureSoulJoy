import { shouldScrollToEnd } from "../../src/utils/scrollPolicy";

describe("scroll policy", () => {
  it("scrolls after user message added", () => {
    expect(shouldScrollToEnd("user_message_added")).toBe(true);
  });
  it("scrolls after assistant pending added", () => {
    expect(shouldScrollToEnd("assistant_pending_added")).toBe(true);
  });
  it("scrolls after assistant response received", () => {
    expect(shouldScrollToEnd("assistant_response_received")).toBe(true);
  });
  it("scrolls after assistant response failed", () => {
    expect(shouldScrollToEnd("assistant_response_failed")).toBe(true);
  });
});
