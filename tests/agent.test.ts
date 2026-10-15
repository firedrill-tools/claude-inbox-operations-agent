import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { AgentRunError, runAgent, type AgentRunOptions } from "../src/agent.js";
import { Mailbox } from "../src/mailbox.js";

const root = resolve(import.meta.dirname, "../..");
const usage = { input_tokens: 40, output_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: "standard" };
const modelUsage = { "claude-sonnet-4-6": { inputTokens: 40, outputTokens: 12, cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.0003, contextWindow: 200000, maxOutputTokens: 64000 } };
function result(overrides = {}) {
  return { type: "result", subtype: "success", is_error: false, result: "Synthetic answer", total_cost_usd: 0.0003,
    duration_ms: 5, duration_api_ms: 3, num_turns: 1, stop_reason: "end_turn", usage, modelUsage,
    permission_denials: [], uuid: "00000000-0000-4000-8000-000000000001", session_id: "synthetic-session", ...overrides };
}
function fixture(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "inbox-sdk-proof-"));
  const path = join(dir, "mailbox.json");
  copyFileSync(join(root, "fixtures/starter-mailbox.json"), path);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { path, options: { connection: { type: "stdio", statePath: path }, request: "Find the October invoice",
    requestId: "review-1002", model: "claude-sonnet-4-6", allowSend: false, allowLabel: false } satisfies AgentRunOptions };
}
function protocol(body: object, beforeSpawn?: () => void) {
  let cwd: string | undefined;
  let args: string[] = [];
  let exited: Promise<unknown> = Promise.resolve();
  const spawnClaudeCodeProcess: NonNullable<Options["spawnClaudeCodeProcess"]> = options => {
    beforeSpawn?.();
    cwd = options.cwd; args = options.args;
    const child = spawn(process.execPath, [join(root, "tests/fake-claude.mjs")], {
      cwd, env: { ...options.env, INBOX_TEST_RESULT: JSON.stringify(body) }, stdio: ["pipe", "pipe", "pipe"], signal: options.signal,
    });
    exited = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
    return child;
  };
  return { spawnClaudeCodeProcess, get cwd() { return cwd; }, get args() { return args; }, get exited() { return exited; } };
}
const key = "synthetic-not-a-secret";

test("actual SDK protocol retains result/model accounting and removes its ephemeral session directory", async t => {
  process.env.ANTHROPIC_API_KEY = key;
  const { options } = fixture(t);
  const child = protocol({ result: result() });
  const outcome = await runAgent(options, child);
  assert.equal(outcome.answer, "Synthetic answer");
  assert.deepEqual(outcome.observation.result?.modelUsage, modelUsage);
  assert.deepEqual(outcome.observation.result?.usage, usage);
  assert.equal(outcome.costUsd, 0.0003);
  assert.equal(outcome.observation.initialState.dataset?.caseId, "starter-mailbox");
  assert.equal(outcome.observation.initialState.stateSha256, outcome.observation.finalState?.stateSha256);
  assert.match(outcome.observation.promptSha256, /^[0-9a-f]{64}$/);
  assert.ok(child.args.includes("--no-session-persistence"));
  assert.ok(child.args.includes("--strict-mcp-config"));
  assert.ok(child.args.some(value => value.includes("maxBudgetUsd") || value.includes("max-budget-usd") || value.includes("max-budget")));
  assert.ok(child.cwd && !existsSync(child.cwd));
  await child.exited;
});

for (const [name, overrides] of [
  ["API error inside success subtype", { is_error: true }], ["empty answer", { result: " " }],
  ["max turns", { subtype: "error_max_turns", errors: ["synthetic turn limit"] }],
  ["budget exhaustion", { subtype: "error_max_budget_usd", errors: ["synthetic budget limit"] }],
  ["unfinished model stop", { stop_reason: "max_tokens" }], ["pending user turn", { queued_turn_count: 1 }],
] as const) test(`actual SDK rejects ${name} without discarding its result`, async t => {
  process.env.ANTHROPIC_API_KEY = key;
  const { options } = fixture(t);
  const child = protocol({ result: result(overrides) });
  await assert.rejects(runAgent(options, child), error => {
    assert.ok(error instanceof AgentRunError);
    assert.deepEqual(error.observation.result?.modelUsage, modelUsage);
    assert.equal(error.observation.finalState?.sentCount, 0);
    return true;
  });
  assert.ok(child.cwd && !existsSync(child.cwd));
  await child.exited;
});

test("SDK stream ending without a result is not completion", async t => {
  process.env.ANTHROPIC_API_KEY = key;
  const { options } = fixture(t);
  const child = protocol({ mode: "no-result" });
  await assert.rejects(runAgent(options, child), error => error instanceof AgentRunError && error.observation.result === null);
  await child.exited;
});

for (const [requestId, allowSend, expected] of [["review-1002", true, "allow"], ["model-invented", true, "deny"], ["review-1002", false, "deny"]] as const) {
  test(`SDK permission callback ${expected === "allow" ? "allows" : "denies"} send ${requestId} with allowSend=${allowSend}`, async t => {
    process.env.ANTHROPIC_API_KEY = key;
    const { options } = fixture(t);
    const child = protocol({ result: result(), permission: { name: "mcp__mailbox__send_message", input: {
      to: "elena@harbor.example", subject: "Review", body: "Thursday works", request_id: requestId,
    } } });
    const outcome = await runAgent({ ...options, allowSend }, child);
    const permission = JSON.parse(outcome.answer);
    assert.equal(permission.response.behavior, expected);
    await child.exited;
  });
}

test("failure after an action preserves committed state and reported failure usage", async t => {
  process.env.ANTHROPIC_API_KEY = key;
  const { options, path } = fixture(t);
  const child = protocol({ result: result({ is_error: true }) }, () => {
    new Mailbox(path).send("elena@harbor.example", "Review", "Thursday works", "review-1002");
  });
  await assert.rejects(runAgent(options, child), error => {
    assert.ok(error instanceof AgentRunError);
    assert.equal(error.observation.initialState.sentCount, 0);
    assert.equal(error.observation.finalState?.sentCount, 1);
    assert.notEqual(error.observation.initialState.stateSha256, error.observation.finalState?.stateSha256);
    assert.deepEqual(error.observation.result?.modelUsage, modelUsage);
    return true;
  });
  await child.exited;
});

test("final state read failure retains SDK result instead of implying rollback", async t => {
  process.env.ANTHROPIC_API_KEY = key;
  const { options, path } = fixture(t);
  const child = protocol({ result: result() }, () => unlinkSync(path));
  await assert.rejects(runAgent(options, child), error => {
    assert.ok(error instanceof AgentRunError);
    assert.equal(error.observation.finalState, null);
    assert.equal(error.observation.finalStateReadError, "Error");
    assert.deepEqual(error.observation.result?.modelUsage, modelUsage);
    return true;
  });
  await child.exited;
});

test("abort deadline closes the SDK child without a completed answer", { timeout: 10000 }, async t => {
  process.env.ANTHROPIC_API_KEY = key;
  const { options } = fixture(t);
  const child = protocol({ mode: "hang" });
  await assert.rejects(runAgent(options, { spawnClaudeCodeProcess: child.spawnClaudeCodeProcess, timeoutMs: 100 }), AgentRunError);
  assert.ok(child.cwd && !existsSync(child.cwd));
  await child.exited;
});

test("missing key and invalid invocation fail before SDK process creation", async t => {
  const { options } = fixture(t);
  const spawnClaudeCodeProcess = () => { throw new Error("must not spawn"); };
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(runAgent(options, { spawnClaudeCodeProcess }), /ANTHROPIC_API_KEY/);
  process.env.ANTHROPIC_API_KEY = key;
  await assert.rejects(runAgent({ ...options, requestId: "bad id" }, { spawnClaudeCodeProcess }), /request ID/);
  await assert.rejects(runAgent({ ...options, request: " " }, { spawnClaudeCodeProcess }), /nonblank/);
  await assert.rejects(runAgent({ ...options, model: "other-provider" }, { spawnClaudeCodeProcess }), /Claude model/);
});
