import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ChatMessage } from "../../components/chat/ChatMessage";
import { normalizeBackendResponseToUIMessage } from "../../src/utils/normalizeBackendResponse";
import {
  pizzaResponse,
  backendErrorResponse,
  clarificationResponse,
  malformedButRenderableResponse,
} from "../../src/testFixtures/goldenBackendResponses";

describe("ChatMessage rendering", () => {
  it("renders assistant text and actions for pizza response", () => {
    const message = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback");
    render(<ChatMessage message={message} />);

    expect(screen.getByTestId("message-text")).toBeTruthy();
    expect(screen.getByText(/Pizza can create/i)).toBeTruthy();
    expect(screen.getByText("Walk for 20 minutes")).toBeTruthy();
  });

  it("does not render raw JSON in the UI", () => {
    const message = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback");
    render(<ChatMessage message={message} />);

    expect(screen.queryByText(/\{"status"/)).toBeNull();
    expect(screen.queryByText(/"actions":/)).toBeNull();
    expect(screen.queryByText(/"traceId"/)).toBeNull();
  });

  it("renders error message for backend error", () => {
    const message = normalizeBackendResponseToUIMessage(backendErrorResponse, "fallback");
    render(<ChatMessage message={message} />);

    expect(screen.getByTestId("message-error")).toBeTruthy();
    expect(screen.queryByText(/BACKEND_TIMEOUT/)).toBeNull();
  });

  it("renders clarification question without action cards", () => {
    const message = normalizeBackendResponseToUIMessage(clarificationResponse, "fallback");
    render(<ChatMessage message={message} />);

    expect(screen.getByText(/Did you mean/i)).toBeTruthy();
    expect(screen.queryByTestId("assistant-actions")).toBeNull();
  });

  it("renders fallback text for malformed response", () => {
    const message = normalizeBackendResponseToUIMessage(malformedButRenderableResponse, "fallback");
    render(<ChatMessage message={message} />);

    expect(screen.getByTestId("message-text")).toBeTruthy();
    const textEl = screen.getByTestId("message-text");
    expect(textEl.props.children.length).toBeGreaterThan(0);
  });

  it("renders user message bubble with typed text", () => {
    const userMessage = {
      id: "u1",
      traceId: "t1",
      role: "user" as const,
      text: "I ate pizza",
      pending: false,
      createdAt: 1,
      source: "keyboard" as const,
    };
    render(<ChatMessage message={userMessage} />);
    expect(screen.getByText("I ate pizza")).toBeTruthy();
  });

  it("renders voice user bubble", () => {
    const voiceMessage = {
      id: "u2",
      traceId: "t2",
      role: "user" as const,
      text: "🎤 Voice input",
      pending: false,
      createdAt: 1,
      source: "voice" as const,
    };
    render(<ChatMessage message={voiceMessage} />);
    expect(screen.getByText("🎤 Voice input")).toBeTruthy();
  });
});
