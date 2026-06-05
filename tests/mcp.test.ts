import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import {
  isJsonRpcRequest,
  mcpResult,
  mcpTools,
  handleMcpMessage,
  handleMcpToolCall,
} from "../src/worker/index.ts";

import { LLMS_TXT } from "../src/worker/constants.ts";

// ---------------------------------------------------------------------------
// Minimal stubs: these tests do not exercise Supabase/R2/env bindings.
// We pass a dummy env and ctx wherever the signatures demand them.
// ---------------------------------------------------------------------------

const dummyEnv = {} as Parameters<typeof handleMcpMessage>[2];
const dummyCtx = {} as ExecutionContext;
const dummyRequest = new Request("https://example.com/mcp", { method: "POST" });

// ---------------------------------------------------------------------------
// isJsonRpcRequest
// ---------------------------------------------------------------------------

test("isJsonRpcRequest: true for object with string method", () => {
  assert.equal(isJsonRpcRequest({ method: "x" }), true);
});

test("isJsonRpcRequest: true for object with method and id", () => {
  assert.equal(isJsonRpcRequest({ id: 1, method: "tools/list" }), true);
});

test("isJsonRpcRequest: false for null", () => {
  assert.equal(isJsonRpcRequest(null), false);
});

test("isJsonRpcRequest: false for string", () => {
  assert.equal(isJsonRpcRequest("string"), false);
});

test("isJsonRpcRequest: false for number", () => {
  assert.equal(isJsonRpcRequest(42), false);
});

test("isJsonRpcRequest: false for array", () => {
  assert.equal(isJsonRpcRequest([{ method: "x" }]), false);
});

test("isJsonRpcRequest: false for object missing method", () => {
  assert.equal(isJsonRpcRequest({ id: 1 }), false);
});

test("isJsonRpcRequest: false for object with non-string method", () => {
  assert.equal(isJsonRpcRequest({ method: 99 }), false);
});

// ---------------------------------------------------------------------------
// mcpResult
// ---------------------------------------------------------------------------

test("mcpResult: returns jsonrpc 2.0", () => {
  const r = mcpResult(1, { ok: true });
  assert.equal(r.jsonrpc, "2.0");
});

test("mcpResult: includes the given id", () => {
  const r = mcpResult(42, { ok: true });
  assert.equal(r.id, 42);
});

test("mcpResult: includes null id when null passed", () => {
  const r = mcpResult(null, { ok: true });
  assert.equal(r.id, null);
});

test("mcpResult: result key matches the passed object", () => {
  const result = { tools: [], extra: "data" };
  const r = mcpResult("abc", result);
  assert.deepEqual(r.result, result);
});

test("mcpResult: shape is exactly {jsonrpc, id, result}", () => {
  const r = mcpResult(1, { x: 2 });
  assert.deepEqual(Object.keys(r).sort(), ["id", "jsonrpc", "result"].sort());
});

// ---------------------------------------------------------------------------
// mcpTools
// ---------------------------------------------------------------------------

test("mcpTools: returns an array", () => {
  assert.ok(Array.isArray(mcpTools()));
});

test("mcpTools: includes describe_share_html tool", () => {
  const tools = mcpTools();
  const found = tools.find((t) => t.name === "describe_share_html");
  assert.ok(found, "describe_share_html should be in tools list");
});

test("mcpTools: describe_share_html has valid inputSchema", () => {
  const tools = mcpTools();
  const found = tools.find((t) => t.name === "describe_share_html");
  assert.ok(found);
  assert.deepEqual(found!.inputSchema, { type: "object", properties: {}, additionalProperties: false });
});

test("mcpTools: includes get_public_share tool", () => {
  const tools = mcpTools();
  const found = tools.find((t) => t.name === "get_public_share");
  assert.ok(found, "get_public_share should be in tools list");
});

test("mcpTools: get_public_share requires slug", () => {
  const tools = mcpTools();
  const found = tools.find((t) => t.name === "get_public_share");
  assert.ok(found);
  assert.deepEqual(found!.inputSchema.required, ["slug"]);
});

test("mcpTools: includes create_share tool", () => {
  const tools = mcpTools();
  const found = tools.find((t) => t.name === "create_share");
  assert.ok(found, "create_share should be in tools list");
});

test("mcpTools: create_share requires html", () => {
  const tools = mcpTools();
  const found = tools.find((t) => t.name === "create_share");
  assert.ok(found);
  assert.deepEqual(found!.inputSchema.required, ["html"]);
});

test("mcpTools: all tools have name, description, inputSchema", () => {
  for (const tool of mcpTools()) {
    assert.ok(typeof tool.name === "string", `tool.name must be string, got ${typeof tool.name}`);
    assert.ok(typeof tool.description === "string", `tool.description must be string for ${tool.name}`);
    assert.ok(typeof tool.inputSchema === "object" && tool.inputSchema !== null, `tool.inputSchema must be object for ${tool.name}`);
  }
});

// ---------------------------------------------------------------------------
// handleMcpMessage — method dispatch (no env/R2 needed)
// ---------------------------------------------------------------------------

test("handleMcpMessage: initialize → protocolVersion 2024-11-05", async () => {
  const msg = { id: 1, method: "initialize", params: {} };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const result = (res!.result as Record<string, unknown>);
  assert.equal(result.protocolVersion, "2024-11-05");
});

test("handleMcpMessage: initialize → capabilities.tools is object", async () => {
  const msg = { id: 1, method: "initialize" };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const result = (res!.result as Record<string, unknown>);
  const capabilities = result.capabilities as Record<string, unknown>;
  assert.ok(typeof capabilities.tools === "object");
});

test("handleMcpMessage: initialize → serverInfo.name is Share HTML", async () => {
  const msg = { id: 1, method: "initialize" };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const result = (res!.result as Record<string, unknown>);
  const serverInfo = result.serverInfo as Record<string, unknown>;
  assert.equal(serverInfo.name, "Share HTML");
});

test("handleMcpMessage: tools/list → returns tools array", async () => {
  const msg = { id: 2, method: "tools/list" };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const result = (res!.result as Record<string, unknown>);
  assert.ok(Array.isArray(result.tools));
});

test("handleMcpMessage: tools/list → tools array has describe_share_html", async () => {
  const msg = { id: 2, method: "tools/list" };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const result = (res!.result as Record<string, unknown>);
  const tools = result.tools as Array<{ name: string }>;
  assert.ok(tools.some((t) => t.name === "describe_share_html"));
});

test("handleMcpMessage: unknown method → error code -32601", async () => {
  const msg = { id: 3, method: "no_such_method" };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const error = res!.error as Record<string, unknown>;
  assert.equal(error.code, -32601);
});

test("handleMcpMessage: invalid request (non-object) → error code -32600", async () => {
  const res = await handleMcpMessage("not-an-object", dummyRequest, dummyEnv, dummyCtx);
  assert.ok(res !== null);
  const error = res!.error as Record<string, unknown>;
  assert.equal(error.code, -32600);
});

test("handleMcpMessage: notification (no id field) → returns null", async () => {
  // A valid JSON-RPC notification has a method but no id field
  const msg = { method: "notifications/initialized" };
  const res = await handleMcpMessage(msg, dummyRequest, dummyEnv, dummyCtx);
  assert.equal(res, null);
});

// ---------------------------------------------------------------------------
// handleMcpToolCall — describe_share_html (no env needed)
// ---------------------------------------------------------------------------

test("handleMcpToolCall: describe_share_html → returns LLMS_TXT content", async () => {
  const res = await handleMcpToolCall(
    1,
    { name: "describe_share_html", arguments: {} },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  const content = result.content as Array<{ type: string; text: string }>;
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "text");
  assert.equal(content[0].text, LLMS_TXT);
});

test("handleMcpToolCall: describe_share_html → isError not present or false", async () => {
  const res = await handleMcpToolCall(
    1,
    { name: "describe_share_html", arguments: {} },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  assert.ok(!result.isError);
});

// ---------------------------------------------------------------------------
// handleMcpToolCall — create_share with missing html → isError
// ---------------------------------------------------------------------------

test("handleMcpToolCall: create_share with missing html → isError", async () => {
  const res = await handleMcpToolCall(
    2,
    { name: "create_share", arguments: {} },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  assert.equal(result.isError, true);
});

test("handleMcpToolCall: create_share with empty html string → isError", async () => {
  const res = await handleMcpToolCall(
    2,
    { name: "create_share", arguments: { html: "" } },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  assert.equal(result.isError, true);
});

test("handleMcpToolCall: unknown tool name → isError", async () => {
  const res = await handleMcpToolCall(
    3,
    { name: "nonexistent_tool", arguments: {} },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  assert.equal(result.isError, true);
});

// ---------------------------------------------------------------------------
// handleMcpToolCall — get_public_share (mocked via vi.mock or fetch stub)
// ---------------------------------------------------------------------------

test("handleMcpToolCall: get_public_share with missing slug → isError", async () => {
  const res = await handleMcpToolCall(
    4,
    { name: "get_public_share", arguments: {} },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  assert.equal(result.isError, true);
});

test("handleMcpToolCall: get_public_share with empty slug → isError", async () => {
  const res = await handleMcpToolCall(
    4,
    { name: "get_public_share", arguments: { slug: "" } },
    dummyRequest,
    dummyEnv,
    dummyCtx
  );
  const result = res.result as Record<string, unknown>;
  assert.equal(result.isError, true);
});
