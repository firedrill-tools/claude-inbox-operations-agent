import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runAgent } from "./agent.js";
import { loadState } from "./mailbox.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function help(): void {
  console.log(`Usage:
  npm run mailbox -- init --seed fixtures/starter-mailbox.json --state run-output/mailbox.json
  npm run mailbox -- ask --state run-output/mailbox.json --request "Find the October invoice"

Options for ask: --request-id ID, --model MODEL, --allow-send, --allow-label
Only a synthetic local mailbox state file is accepted. The ask command makes a real Claude model call.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return help();
  if (args[0] === "init") {
    const seed = resolve(required(args, "--seed"));
    const state = resolve(required(args, "--state"));
    loadState(seed);
    if (existsSync(state)) throw new Error(`state already exists: ${state}`);
    mkdirSync(dirname(state), { recursive: true });
    copyFileSync(seed, state);
    console.log(JSON.stringify({ state, messageCount: loadState(state).messages.length }));
    return;
  }
  if (args[0] === "ask") {
    const state = resolve(required(args, "--state"));
    const request = required(args, "--request");
    const requestId = option(args, "--request-id") ?? randomUUID();
    if (!requestId || requestId.startsWith("--")) throw new Error("--request-id needs a value");
    const outcome = await runAgent({
      statePath: state,
      request,
      requestId,
      model: option(args, "--model") ?? process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
      allowSend: args.includes("--allow-send"),
      allowLabel: args.includes("--allow-label"),
    });
    console.log(JSON.stringify(outcome));
    return;
  }
  throw new Error(`unknown command: ${args[0]}`);
}

main().catch((error: unknown) => {
  console.error(`mailbox: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
