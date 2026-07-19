import assert from "node:assert/strict";
import { test } from "vitest";

import { handleA2aRequest } from "../src/worker/a2a.ts";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://sharehtml.zhenjia.dev/a2a", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("A2A: non-POST transport requests return 405", async () => {
  const response = await handleA2aRequest(new Request("https://sharehtml.zhenjia.dev/a2a"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("A2A: SendMessage returns a direct agent message with the canonical guide", async () => {
  const response = await handleA2aRequest(post({
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-1",
        contextId: "context-1",
        role: "ROLE_USER",
        parts: [{ text: "How do I create a private link?" }],
      },
    },
  }, { "a2a-version": "1.0" }));

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, any>;
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 1);
  assert.equal(body.result.message.role, "ROLE_AGENT");
  assert.equal(body.result.message.contextId, "context-1");
  assert.match(body.result.message.parts[0].text, /private_link/);
  assert.match(body.result.message.parts[0].text, /#key=/);
});

test("A2A: task operations truthfully report an empty stateless task inventory", async () => {
  const list = await handleA2aRequest(post({
    jsonrpc: "2.0",
    id: 2,
    method: "ListTasks",
    params: { pageSize: 25 },
  }));
  const listBody = await list.json() as Record<string, any>;
  assert.deepEqual(listBody.result, {
    tasks: [],
    nextPageToken: "",
    pageSize: 25,
    totalSize: 0,
  });

  const get = await handleA2aRequest(post({
    jsonrpc: "2.0",
    id: 3,
    method: "GetTask",
    params: { id: "missing" },
  }));
  const getBody = await get.json() as Record<string, any>;
  assert.equal(getBody.error.code, -32001);
});

test("A2A: unsupported streaming is explicit and matches the card capability", async () => {
  const response = await handleA2aRequest(post({
    jsonrpc: "2.0",
    id: 4,
    method: "SendStreamingMessage",
    params: {},
  }));
  const body = await response.json() as Record<string, any>;
  assert.equal(body.error.code, -32004);
});

test("A2A: rejects unsupported versions and cross-origin browser calls", async () => {
  const versionResponse = await handleA2aRequest(post({
    jsonrpc: "2.0",
    id: 5,
    method: "ListTasks",
  }, { "a2a-version": "0.3" }));
  assert.equal(versionResponse.status, 400);
  assert.deepEqual((await versionResponse.json() as Record<string, unknown>).supportedVersions, ["1.0"]);

  const originResponse = await handleA2aRequest(post({
    jsonrpc: "2.0",
    id: 6,
    method: "ListTasks",
  }, { origin: "https://attacker.example" }));
  assert.equal(originResponse.status, 403);
});
