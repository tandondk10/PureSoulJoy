import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AssistantActionRenderer } from "../../components/chat/AssistantActionRenderer";
import { normalizeBackendResponseToUIMessage } from "../../src/utils/normalizeBackendResponse";
import { pizzaResponse, noActionsResponse } from "../../src/testFixtures/goldenBackendResponses";

describe("AssistantActionRenderer", () => {
  it("renders all backend actions from a normalized pizza response", () => {
    const message = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback");
    render(<AssistantActionRenderer actions={message.actions} />);

    expect(screen.getByTestId("assistant-actions")).toBeTruthy();
    expect(screen.getByText("Walk for 20 minutes")).toBeTruthy();
    expect(screen.getByText("Drink water")).toBeTruthy();
  });

  it("renders nothing when no actions exist", () => {
    const message = normalizeBackendResponseToUIMessage(noActionsResponse, "fallback");
    const { queryByTestId } = render(<AssistantActionRenderer actions={message.actions} />);
    expect(queryByTestId("assistant-actions")).toBeNull();
  });

  it("renders action duration when provided", () => {
    const message = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback");
    render(<AssistantActionRenderer actions={message.actions} />);
    expect(screen.getByText("20 min")).toBeTruthy();
  });

  it("renders action intensity when provided", () => {
    const message = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback");
    render(<AssistantActionRenderer actions={message.actions} />);
    expect(screen.getByText("high")).toBeTruthy();
  });

  it("renders actions in priority order", () => {
    const message = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback");
    render(<AssistantActionRenderer actions={message.actions} />);
    // Walk (priority 1) should render before Drink water (priority 2)
    const titles = screen.getAllByTestId("action-title").map((t) => t.props.children);
    expect(titles[0]).toBe("Walk for 20 minutes");
    expect(titles[1]).toBe("Drink water");
  });
});
