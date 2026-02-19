import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, it, expect } from "vitest";
import { extractToolCallsFromAssistant } from "./tool-call-id.js";

// Helper to create a minimal AssistantMessage for testing
function createTestAssistantMessage(
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
): Extract<AgentMessage, { role: "assistant" }> {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("extractToolCallsFromAssistant", () => {
  it("extracts valid tool calls", () => {
    const msg = createTestAssistantMessage([
      {
        type: "toolCall",
        id: "call_123",
        name: "calculator",
        arguments: {},
      },
    ]);
    const result = extractToolCallsFromAssistant(msg);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "call_123", name: "calculator" });
  });

  it("sanitizes tool names (trim + lowercase via normalizeToolName)", () => {
    const msg = createTestAssistantMessage([
      {
        type: "toolCall",
        id: "call_ABC",
        name: "  MyToolName  ",
        arguments: {},
      },
    ]);
    const result = extractToolCallsFromAssistant(msg);
    expect(result).toHaveLength(1);
    // normalizeToolName trims and lowercases
    expect(result[0]).toEqual({ id: "call_ABC", name: "mytoolname" });
  });

  it("handles missing names gracefully", () => {
    const msg = createTestAssistantMessage([
      {
        type: "toolCall",
        id: "call_456",
        name: undefined as unknown as string,
        arguments: {},
      },
    ]);
    const result = extractToolCallsFromAssistant(msg);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "call_456", name: undefined });
  });
});
