import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { addConversationCacheMarkers, applyExtraParamsToAgent } from "../pi-embedded-runner.js";

// Mock the logger to avoid noise in tests
vi.mock("./logger.js", () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

type TestMessage = {
  role?: string;
  content?: string | Array<{ type: string; text?: string; cache_control?: { type: string } }>;
};

function makeMessages(count: number): TestMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));
}

function countCacheMarkers(messages: TestMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.cache_control?.type === "ephemeral") {
          count++;
        }
      }
    }
  }
  return count;
}

function getCacheMarkerIndices(messages: TestMessage[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.cache_control?.type === "ephemeral") {
          indices.push(i);
        }
      }
    }
  }
  return indices;
}

describe("addConversationCacheMarkers", () => {
  it("skips short sessions with fewer than minStable stable messages", () => {
    // 25 total messages, tail=30 → stableCutoff = 0 → no markers
    const messages = makeMessages(25);
    const result = addConversationCacheMarkers(messages, 30);
    expect(countCacheMarkers(result)).toBe(0);
  });

  it("skips when stable messages are below minStable threshold", () => {
    // 40 total, tail=30 → stableCutoff = 10 → below default minStable (20)
    const messages = makeMessages(40);
    const result = addConversationCacheMarkers(messages, 30);
    expect(countCacheMarkers(result)).toBe(0);
  });

  it("places 1 marker for a medium session", () => {
    // 55 total, tail=30 → stableCutoff = 25 → floor(25/20) = 1 marker
    const messages = makeMessages(55);
    const result = addConversationCacheMarkers(messages, 30);
    expect(countCacheMarkers(result)).toBe(1);

    // Marker placed at the end of the stable zone (indices 0..24)
    // With 1 marker: idx = floor(25 * 1 / 1) - 1 = 24
    const indices = getCacheMarkerIndices(result);
    expect(indices).toEqual([24]);
  });

  it("places 2 markers for a longer session", () => {
    // 80 total, tail=30 → stableCutoff = 50 → floor(50/20) = 2 markers (capped at 2)
    const messages = makeMessages(80);
    const result = addConversationCacheMarkers(messages, 30);
    expect(countCacheMarkers(result)).toBe(2);

    // Markers at: floor(50*1/2)-1 = 24, floor(50*2/2)-1 = 49
    const indices = getCacheMarkerIndices(result);
    expect(indices).toEqual([24, 49]);
  });

  it("places 3 markers (maximum) for a long session", () => {
    // 120 total, tail=30 → stableCutoff = 90 → floor(90/20) = 4 → capped at 3
    const messages = makeMessages(120);
    const result = addConversationCacheMarkers(messages, 30);
    expect(countCacheMarkers(result)).toBe(3);

    // Markers at: floor(90*1/3)-1 = 29, floor(90*2/3)-1 = 59, floor(90*3/3)-1 = 89
    const indices = getCacheMarkerIndices(result);
    expect(indices).toEqual([29, 59, 89]);

    // All markers should be in the stable zone (before index 90)
    for (const idx of indices) {
      expect(idx).toBeLessThan(90);
    }
  });

  it("caches all messages when tailCount=0", () => {
    // 60 total, tail=0 → stableCutoff = 60 → 3 markers
    const messages = makeMessages(60);
    const result = addConversationCacheMarkers(messages, 0);
    expect(countCacheMarkers(result)).toBe(3);

    // With stableCutoff=60 and 3 markers:
    // idx = floor(60*1/3)-1 = 19, floor(60*2/3)-1 = 39, floor(60*3/3)-1 = 59
    const indices = getCacheMarkerIndices(result);
    expect(indices).toEqual([19, 39, 59]);
  });

  it("converts string content to content blocks when adding markers", () => {
    const messages = makeMessages(55);
    // Verify content starts as string
    // With 55 msgs, tail=30 → stableCutoff=25, 1 marker at floor(25*1/1)-1 = 24
    expect(typeof messages[24].content).toBe("string");

    addConversationCacheMarkers(messages, 30);

    // The marked message should have its content converted to blocks
    expect(Array.isArray(messages[24].content)).toBe(true);
    const blocks = messages[24].content as Array<{
      type: string;
      text?: string;
      cache_control?: { type: string };
    }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toBe("message 24");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("attaches cache_control to last block of existing content arrays", () => {
    const messages = makeMessages(55);
    // Pre-convert the marker message (index 24) to content block format
    // With 55 msgs, tail=30 → stableCutoff=25, 1 marker at floor(25*1/1)-1 = 24
    messages[24].content = [
      { type: "text", text: "first part" },
      { type: "text", text: "second part" },
    ];

    addConversationCacheMarkers(messages, 30);

    const blocks = messages[24].content as Array<{
      type: string;
      text?: string;
      cache_control?: { type: string };
    }>;
    // cache_control should be on the last block only
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("uses custom minStable parameter", () => {
    // 40 total, tail=30, minStable=5 → stableCutoff=10 → floor(10/5) = 2 markers
    const messages = makeMessages(40);
    const result = addConversationCacheMarkers(messages, 30, 5);
    expect(countCacheMarkers(result)).toBe(2);
  });

  it("does not modify messages outside the stable zone", () => {
    const messages = makeMessages(120);
    addConversationCacheMarkers(messages, 30);

    // Messages from index 90 onward (tail zone) should remain as strings
    for (let i = 90; i < 120; i++) {
      expect(typeof messages[i].content).toBe("string");
    }
  });
});

describe("conversation cache markers integration via applyExtraParamsToAgent", () => {
  it("applies cache markers via onPayload for Anthropic provider", () => {
    const payloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = {
        messages: makeMessages(60),
      };
      options?.onPayload?.(payload);
      payloads.push(payload);
      return {} as ReturnType<StreamFn>;
    };
    const agent = { streamFn: baseStreamFn };

    applyExtraParamsToAgent(agent, undefined, "anthropic", "claude-opus-4-6");

    const context: Context = { messages: [] };
    void agent.streamFn?.(
      {
        api: "anthropic-messages",
        provider: "anthropic",
        id: "claude-opus-4-6",
      } as Parameters<StreamFn>[0],
      context,
      {},
    );

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as { messages: TestMessage[] };
    // Default tail=30, stableCutoff=30 → floor(30/20) = 1 marker
    expect(countCacheMarkers(payload.messages)).toBe(1);
  });

  it("does not apply cache markers for non-Anthropic providers", () => {
    const payloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = {
        messages: makeMessages(120),
      };
      options?.onPayload?.(payload);
      payloads.push(payload);
      return {} as ReturnType<StreamFn>;
    };
    const agent = { streamFn: baseStreamFn };

    applyExtraParamsToAgent(agent, undefined, "openai", "gpt-4");

    const context: Context = { messages: [] };
    void agent.streamFn?.(
      { api: "openai-completions", provider: "openai", id: "gpt-4" } as Parameters<StreamFn>[0],
      context,
      {},
    );

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as { messages: TestMessage[] };
    expect(countCacheMarkers(payload.messages)).toBe(0);
  });

  it("respects cacheConversationTail: 0 to disable", () => {
    const payloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = {
        messages: makeMessages(120),
      };
      options?.onPayload?.(payload);
      payloads.push(payload);
      return {} as ReturnType<StreamFn>;
    };
    const agent = { streamFn: baseStreamFn };
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              params: {
                cacheRetention: "short" as const,
                cacheConversationTail: 0,
              },
            },
          },
        },
      },
    };

    applyExtraParamsToAgent(agent, cfg, "anthropic", "claude-opus-4-6");

    const context: Context = { messages: [] };
    void agent.streamFn?.(
      {
        api: "anthropic-messages",
        provider: "anthropic",
        id: "claude-opus-4-6",
      } as Parameters<StreamFn>[0],
      context,
      {},
    );

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as { messages: TestMessage[] };
    expect(countCacheMarkers(payload.messages)).toBe(0);
  });

  it("uses custom cacheConversationTail value", () => {
    const payloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = {
        messages: makeMessages(120),
      };
      options?.onPayload?.(payload);
      payloads.push(payload);
      return {} as ReturnType<StreamFn>;
    };
    const agent = { streamFn: baseStreamFn };
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              params: {
                cacheRetention: "short" as const,
                cacheConversationTail: 10,
              },
            },
          },
        },
      },
    };

    applyExtraParamsToAgent(agent, cfg, "anthropic", "claude-opus-4-6");

    const context: Context = { messages: [] };
    void agent.streamFn?.(
      {
        api: "anthropic-messages",
        provider: "anthropic",
        id: "claude-opus-4-6",
      } as Parameters<StreamFn>[0],
      context,
      {},
    );

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as { messages: TestMessage[] };
    // tail=10, stableCutoff=110 → 3 markers (capped)
    expect(countCacheMarkers(payload.messages)).toBe(3);
  });
});
