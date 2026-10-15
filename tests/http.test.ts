import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startMailboxHttp } from "../src/http-server.js";
import { mailboxMcpConfig, remoteMailboxStatus } from "../src/connection.js";
import { loadState } from "../src/mailbox.js";

const root = resolve(import.meta.dirname, "../..");
function state() {
  const dir = mkdtempSync(join(tmpdir(), "inbox-http-"));
  const path = join(dir, "mailbox.json");
  copyFileSync(join(root, "fixtures/starter-mailbox.json"), path);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("HTTP MCP executes reads, labels and replay-safe sends against persisted state", async (t) => {
  const fixture = state();
  const token = randomBytes(32).toString("hex");
  const server = await startMailboxHttp({ statePath: fixture.path, token, port: 0, allowLabel: true, allowSend: true });
  t.after(async () => { await server.close(); fixture.cleanup(); });
  const client = new Client({ name: "http-proof", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  t.after(() => client.close());
  const search = await client.callTool({ name: "search_messages", arguments: { query: "invoice" } });
  assert.match(JSON.stringify(search.content), /m-1001/);
  const labeled = await client.callTool({ name: "add_label", arguments: { message_id: "m-1001", label: "followup" } });
  assert.ok(!labeled.isError);
  const send = { name: "send_message", arguments: { to: "elena@harbor.example", subject: "Review", body: "Thursday works", request_id: "http-1" } };
  const first = await client.callTool(send);
  const replay = await client.callTool(send);
  assert.deepEqual(first.content, replay.content);
  assert.equal(loadState(fixture.path).sent.length, 1);
  assert.ok(loadState(fixture.path).messages[0].labels.includes("followup"));
  assert.equal(loadState(fixture.path).audit.at(-1)?.result, "duplicate");
  assert.deepEqual(await remoteMailboxStatus({ type: "http", url: server.url, token }), {
    synthetic: true, version: 1, sentCount: 1, auditCount: 3,
  });
});

test("missing token, wrong token, foreign Host and foreign Origin cannot reach tools", async (t) => {
  const fixture = state(); const token = randomBytes(32).toString("hex");
  const server = await startMailboxHttp({ statePath: fixture.path, token, port: 0, allowSend: true, allowLabel: true });
  t.after(async () => { await server.close(); fixture.cleanup(); });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(server.url)).status, 401);
  assert.equal((await fetch(server.url, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    request(server.url, { headers: { ...headers, Host: "foreign.example" } }, res => { res.resume(); resolve(res.statusCode); })
      .on("error", reject).end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(server.url, { headers: { ...headers, Origin: "https://foreign.example" } })).status, 403);
  assert.equal((await fetch(`${server.url}/wrong`, { headers })).status, 404);
  await assert.rejects(remoteMailboxStatus({ type: "http", url: server.url, token: "wrong".repeat(10) }));
  assert.equal(loadState(fixture.path).sent.length, 0);
  assert.equal(loadState(fixture.path).audit.length, 0);
});

test("default HTTP and stdio servers deny writes independently of client permissions", async (t) => {
  const fixture = state(); const token = randomBytes(32).toString("hex");
  const server = await startMailboxHttp({ statePath: fixture.path, token, port: 0, allowSend: false, allowLabel: false });
  t.after(async () => { await server.close(); fixture.cleanup(); });
  const transports = [
    new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    new StdioClientTransport({ command: process.execPath, args: [join(root, "dist/src/mcp-server.js"), "--state", fixture.path] }),
  ];
  for (const transport of transports) {
    const client = new Client({ name: "untrusted-write", version: "1.0.0" });
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ["get_message", "mailbox_status", "search_messages"]);
      await assert.rejects(client.callTool({ name: "send_message", arguments: { to: "elena@harbor.example", subject: "Unauthorized", body: "No", request_id: "denied" } }), /not found/);
    } finally { await client.close(); }
  }
  assert.equal(loadState(fixture.path).sent.length, 0);
});

test("remote configuration fails closed and a stopped endpoint does not fall back", async (t) => {
  const fixture = state(); const token = randomBytes(32).toString("hex");
  t.after(fixture.cleanup);
  for (const url of ["http://remote.example/mcp", "https://user:pass@remote.example/mcp", "https://remote.example/mcp?token=secret"]) {
    assert.throws(() => mailboxMcpConfig({ type: "http", url, token }, { allowSend: false, allowLabel: false }));
  }
  assert.throws(() => mailboxMcpConfig({ type: "http", url: "https://remote.example/mcp", token: "short" }, { allowSend: false, allowLabel: false }));
  const server = await startMailboxHttp({ statePath: fixture.path, token, port: 0, allowSend: false, allowLabel: false });
  assert.equal((await remoteMailboxStatus({ type: "http", url: server.url, token })).synthetic, true);
  await server.close();
  await server.close();
  await assert.rejects(remoteMailboxStatus({ type: "http", url: server.url, token }));
  assert.equal(loadState(fixture.path).audit.length, 0);
});

test("HTTP endpoint serves the older MCP protocol used by existing clients", async (t) => {
  const fixture = state(); const token = randomBytes(32).toString("hex");
  const server = await startMailboxHttp({ statePath: fixture.path, token, port: 0, allowSend: false, allowLabel: false });
  t.after(async () => { await server.close(); fixture.cleanup(); });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" };
  const initialized = await fetch(server.url, { method: "POST", headers, body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-proof", version: "1.0.0" } },
  }) });
  assert.equal(initialized.status, 200);
  async function rpcBody(response: Response) {
    const text = await response.text();
    return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n") : text);
  }
  assert.equal((await rpcBody(initialized)).result.protocolVersion, "2025-11-25");
  const listed = await fetch(server.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  assert.equal(listed.status, 200);
  const body = await rpcBody(listed) as { result: { tools: { name: string }[] } };
  assert.deepEqual(body.result.tools.map(tool => tool.name).sort(), ["get_message", "mailbox_status", "search_messages"]);
});

test("serve CLI signals readiness, keeps its token private and stops on SIGTERM", async (t) => {
  const fixture = state(); const token = randomBytes(32).toString("hex");
  t.after(fixture.cleanup);
  const child = spawn(process.execPath, [join(root, "dist/src/cli.js"), "serve", "--state", fixture.path, "--port", "0"], {
    env: { ...process.env, MAILBOX_MCP_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  const lines = createInterface({ input: child.stdout });
  t.after(() => { lines.close(); child.kill("SIGKILL"); });
  let errors = ""; child.stderr.on("data", data => { errors += String(data); });
  const [line] = await once(lines, "line", { signal: AbortSignal.timeout(10000) });
  assert.ok(!String(line).includes(token));
  const ready = JSON.parse(String(line)) as { ready: boolean; url: string };
  assert.equal(ready.ready, true);
  assert.equal((await remoteMailboxStatus({ type: "http", url: ready.url, token })).synthetic, true);
  child.kill("SIGTERM");
  const [code] = await Promise.race([closed, new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("serve did not stop")), 5000); timer.unref();
  })]);
  assert.equal(code, 0, errors);
  assert.ok(!errors.includes(token));
  await assert.rejects(fetch(ready.url));
  const invalid = spawnSync(process.execPath, [join(root, "dist/src/cli.js"), "ask", "--state", fixture.path, "--mcp-url", ready.url, "--request", "Find invoice"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /exactly one/);
});
