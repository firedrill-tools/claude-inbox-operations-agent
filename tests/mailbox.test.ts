import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Mailbox, loadState } from "../src/mailbox.js";

const root = resolve(import.meta.dirname, "../..");

function seededState(seed = "starter-mailbox.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "inbox-agent-"));
  const statePath = join(dir, "mailbox.json");
  copyFileSync(join(root, "fixtures", seed), statePath);
  return statePath;
}

test("synthetic send is idempotent and never reaches an external provider", () => {
  const path = seededState();
  const mailbox = new Mailbox(path);
  const first = mailbox.send("elena@harbor.example", "Review", "Thursday works", "req-1");
  const second = mailbox.send("elena@harbor.example", "Review", "Thursday works", "req-1");
  assert.deepEqual(first, second);
  assert.equal(loadState(path).sent.length, 1);
  assert.equal(loadState(path).audit.at(-1)?.result, "duplicate");
});

test("blocked synthetic delivery leaves the outbox unchanged", () => {
  const path = seededState("send-failure-mailbox.json");
  const result = new Mailbox(path).send("elena@harbor.example", "Review", "Thursday works", "req-2");
  assert.deepEqual(result, { error: "synthetic delivery temporarily failed" });
  assert.equal(loadState(path).sent.length, 0);
});

test("a request ID cannot be reused for a different recipient", () => {
  const path = seededState();
  const mailbox = new Mailbox(path);
  mailbox.send("elena@harbor.example", "Review", "Thursday works", "req-3");
  const altered = mailbox.send("elena@harborlabs.example", "Review", "Thursday works", "req-3");
  assert.deepEqual(altered, { error: "request ID was already used for a different message" });
  assert.equal(loadState(path).sent.length, 1);
});

test("MCP server exposes read and write tools against one state file", async () => {
  const path = seededState();
  const client = new Client({ name: "offline-check", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "src", "mcp-server.js"), "--state", path, "--allow-label", "--allow-send"],
  });
  await client.connect(transport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), ["mailbox_status", "add_label", "get_message", "search_messages", "send_message"].sort());
    const search = await client.callTool({ name: "search_messages", arguments: { query: "invoice" } });
    assert.equal(search.isError, undefined);
    assert.match(JSON.stringify(search.content), /m-1001/);
    const labeled = await client.callTool({ name: "add_label", arguments: { message_id: "m-1001", label: "followup" } });
    assert.equal(labeled.isError, undefined);
    assert.ok(loadState(path).messages[0].labels.includes("followup"));
  } finally {
    await client.close();
  }
});

test("fixture contains only fictional addresses", () => {
  const state = JSON.parse(readFileSync(join(root, "fixtures", "starter-mailbox.json"), "utf8"));
  assert.equal(state.synthetic, true);
  assert.ok(state.allowedRecipients.every((email: string) => email.endsWith(".example")));
});
