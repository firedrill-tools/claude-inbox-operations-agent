import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { resolve } from "node:path";
import { createMailboxServer } from "./mcp-tools.js";

function stateArgument(): string {
  const index = process.argv.indexOf("--state");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--state is required");
  return resolve(process.argv[index + 1]);
}

const statePath = stateArgument();
void serveStdio(() => createMailboxServer(statePath, {
  allowSend: process.argv.includes("--allow-send"),
  allowLabel: process.argv.includes("--allow-label"),
}));
