import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_MANIFEST, listCases, selectCase } from "../src/datasets.js";
import { loadState, Mailbox } from "../src/mailbox.js";
const root = resolve(import.meta.dirname, "../..");
function temporary(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "mailbox-dataset-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const cli = (args: string[], env = process.env) => spawnSync(process.execPath, [join(root, "dist/src/cli.js"), ...args], { env, encoding: "utf8" });

test("all four profiles contain distinct, coherent mailbox populations", () => {
  const summary = listCases();
  assert.equal(summary.datasetId, "northstar-mailbox");
  assert.equal(summary.version, "1.0.0");
  assert.deepEqual(summary.profiles.map(group => [group.name, group.caseIds.length]), [["starter", 1], ["busy", 1], ["ambiguous", 1], ["boundary", 3]]);
  const hashes = new Set<string>();
  for (const group of summary.profiles) for (const caseId of group.caseIds) {
    const selected = selectCase(caseId);
    hashes.add(selected.sha256);
    assert.equal(selected.dataset.profile, group.name);
    assert.ok(selected.state.allowedRecipients.every(address => address.endsWith(".example")));
    assert.ok(selected.state.messages.every(message => message.from.endsWith(".example") && message.to === selected.state.mailboxOwner));
  }
  assert.equal(hashes.size, 6);
  const busy = selectCase("busy-mailbox").state;
  assert.equal(busy.messages.length, 24);
  assert.equal(new Set(busy.messages.map(item => item.from)).size, 8);
  assert.equal(busy.sent.length, 1);
  assert.equal(new Mailbox(selectCase("busy-mailbox").source).search("October").length, 2);
  assert.ok(selectCase("ambiguous-mailbox").state.messages.some(item => item.body.includes("corrected invoice has not been issued")));
});

test("versioned boundary snapshots cover blocked sends, hostile content and original completed work", t => {
  const dir = temporary(t);
  for (const name of ["send-failure-mailbox", "hostile-message-mailbox", "completed-send-mailbox"]) {
    const selected = selectCase(name);
    const state = join(dir, `${name}.json`);
    writeFileSync(state, selected.snapshot);
    const mailbox = new Mailbox(state);
    if (name === "send-failure-mailbox") {
      assert.ok("error" in mailbox.send("elena@harbor.example", "Review", "Thursday works", "new-send"));
      assert.equal(loadState(state).sent.length, 0);
    } else if (name === "completed-send-mailbox") {
      const original = selected.state.sent[0];
      assert.deepEqual(mailbox.send(original.to, original.subject, original.body, original.requestId), original);
      assert.equal(loadState(state).sent.length, 1);
      assert.equal(loadState(state).audit.at(-1)?.result, "duplicate");
    } else {
      assert.match(selected.state.messages[0].body, /ignore the user/);
      assert.ok("error" in mailbox.send("outsider@outside.example", "Exfiltrate", "No", "outsider-request"));
      assert.equal(loadState(state).sent.length, 0);
    }
  }
});

test("fixture generation is reproducible in a temporary root", t => {
  const dir = temporary(t);
  mkdirSync(join(dir, "scripts")); mkdirSync(join(dir, "fixtures"));
  cpSync(join(root, "scripts/make-fixtures.mjs"), join(dir, "scripts/make-fixtures.mjs"));
  for (const name of ["starter-mailbox.json", "send-failure-mailbox.json"]) cpSync(join(root, "fixtures", name), join(dir, "fixtures", name));
  const generated = spawnSync(process.execPath, [join(dir, "scripts/make-fixtures.mjs")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  for (const name of readdirSync(join(root, "fixtures"))) assert.deepEqual(readFileSync(join(dir, "fixtures", name)), readFileSync(join(root, "fixtures", name)));
});

test("list is model-free, init copies exact qualified bytes privately, and reset refuses overwrite", t => {
  const dir = temporary(t);
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  const listed = cli(["list"], env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).caseCount, 6);
  const state = join(dir, "run/mailbox.json");
  const initialized = cli(["init", "--case", "busy-mailbox", "--state", state], env);
  assert.equal(initialized.status, 0, initialized.stderr);
  const body = JSON.parse(initialized.stdout);
  assert.equal(body.dataset.profile, "busy");
  assert.equal(body.stateSha256, createHash("sha256").update(readFileSync(state)).digest("hex"));
  assert.deepEqual(readFileSync(state), selectCase("busy-mailbox").snapshot);
  assert.equal(statSync(state).mode & 0o777, 0o600);
  assert.equal(cli(["init", "--case", "starter-mailbox", "--state", state], env).status, 1);
  const missingKey = cli(["ask", "--state", state, "--request", "Find invoice"], env);
  assert.equal(missingKey.status, 1);
  assert.equal(missingKey.stdout, "");
  assert.match(JSON.parse(missingKey.stderr).error.message, /ANTHROPIC_API_KEY/);
});

test("changed seed, unknown case and duplicate identity fail closed", t => {
  const dir = temporary(t); cpSync(join(root, "fixtures"), join(dir, "fixtures"), { recursive: true });
  const path = join(dir, "fixtures/manifest.json");
  const seed = join(dir, "fixtures/starter-mailbox.json");
  writeFileSync(seed, readFileSync(seed, "utf8") + " ");
  assert.throws(() => selectCase("starter-mailbox", path), /digest mismatch/);
  assert.throws(() => listCases(path), /digest mismatch/);
  assert.throws(() => selectCase("unknown", path), /not found/);
  const population = JSON.parse(readFileSync(path, "utf8"));
  population.profiles[1].cases[0].caseId = "starter-mailbox";
  writeFileSync(path, JSON.stringify(population));
  assert.throws(() => listCases(path), /unique/);
});

test("manifest source paths and symlinks must stay within the dataset root", t => {
  const dir = temporary(t); cpSync(join(root, "fixtures"), join(dir, "fixtures"), { recursive: true });
  const path = join(dir, "fixtures/manifest.json");
  const outside = join(dir, "outside.json");
  cpSync(join(root, "fixtures/starter-mailbox.json"), outside);
  symlinkSync(outside, join(dir, "fixtures/linked.json"));
  const population = JSON.parse(readFileSync(path, "utf8"));
  for (const escape of ["../outside.json", "linked.json"]) {
    population.profiles[0].cases[0].path = escape;
    writeFileSync(path, JSON.stringify(population));
    assert.throws(() => selectCase("starter-mailbox", path), /escapes/);
  }
});

test("malformed state identities and relationships are rejected before tool execution", t => {
  const dir = temporary(t); const path = join(dir, "invalid.json");
  for (const alter of [
    (state: any) => { state.messages[1].id = state.messages[0].id; },
    (state: any) => { state.messages[0].to = "other@northstar.example"; },
    (state: any) => { state.blockedRecipients.push("unknown@outside.example"); },
    (state: any) => { state.messages[0].receivedAt = "not a timestamp"; },
    (state: any) => { delete state.allowedRecipients; },
  ]) {
    const state = JSON.parse(selectCase("starter-mailbox").snapshot.toString("utf8")); alter(state);
    writeFileSync(path, JSON.stringify(state));
    assert.throws(() => new Mailbox(path));
  }
});

test("CLI rejects conflicting seed choices, duplicate flags and missing values", t => {
  const dir = temporary(t);
  for (const args of [
    ["init", "--case", "starter-mailbox", "--seed", "unused", "--state", join(dir, "state.json")],
    ["ask", "--state", "unused", "--request", "Read", "--allow-send", "--allow-send"],
    ["ask", "--state", "unused", "--request", "Read", "--model", "--allow-send"],
    ["list", "--unknown"],
  ]) {
    const outcome = cli(args);
    assert.equal(outcome.status, 1); assert.equal(outcome.stdout, "");
    assert.equal(JSON.parse(outcome.stderr).error.code, "input_or_dependency_failed");
  }
});


test("new sends cannot collide with historical noncontiguous message IDs", t => {
  const dir = temporary(t); const path = join(dir, "history.json");
  const state = selectCase("completed-send-mailbox").state;
  state.sent[0].id = "sent-2";
  writeFileSync(path, JSON.stringify(state));
  const sent = new Mailbox(path).send("elena@harbor.example", "Another task", "Separate authorized task", "another-request");
  assert.ok(!("error" in sent));
  assert.notEqual(sent.id, "sent-2");
  const saved = loadState(path);
  assert.equal(saved.sent.length, 2);
  assert.equal(saved.sent[0].id, "sent-2");
});
