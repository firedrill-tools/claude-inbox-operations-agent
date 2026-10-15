import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateToken } from "./http-server.js";
import { type MailboxPermissions } from "./mcp-tools.js";

export type MailboxConnection = { type: "stdio"; statePath: string } | { type: "http"; url: string; token: string };
export interface RemoteStatus { synthetic: true; version: 1; sentCount: number; auditCount: number }

export function mailboxMcpConfig(connection: MailboxConnection, permissions: MailboxPermissions): McpServerConfig {
  if (connection.type === "stdio") return {
    command: process.execPath,
    args: [fileURLToPath(new URL("./mcp-server.js", import.meta.url)), "--state", resolve(connection.statePath),
      ...(permissions.allowSend ? ["--allow-send"] : []), ...(permissions.allowLabel ? ["--allow-label"] : [])],
  };
  validateToken(connection.token);
  const url = new URL(connection.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.hash || url.search) {
    throw new Error("MCP URL must use HTTPS, or HTTP on loopback, without URL credentials, query or fragment");
  }
  return { type: "http", url: url.href, headers: { Authorization: `Bearer ${connection.token}` }, timeout: 10000 };
}

export async function remoteMailboxStatus(connection: Extract<MailboxConnection, { type: "http" }>): Promise<RemoteStatus> {
  const config = mailboxMcpConfig(connection, { allowSend: false, allowLabel: false });
  if (!("type" in config) || config.type !== "http") throw new Error("HTTP configuration required");
  const client = new Client({ name: "mailbox-preflight", version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers, redirect: "error", signal: AbortSignal.timeout(10000) },
  });
  try {
    await client.connect(transport);
    if (client.getServerVersion()?.name !== "synthetic-mailbox") throw new Error("endpoint is not the synthetic mailbox server");
    const result = await client.callTool({ name: "mailbox_status", arguments: {} }, { timeout: 10000 });
    const text = result.content?.find(item => item.type === "text");
    if (result.isError || !text || text.type !== "text") throw new Error("mailbox status is unavailable");
    const status = JSON.parse(text.text) as RemoteStatus;
    if (status.synthetic !== true || status.version !== 1 || !Number.isSafeInteger(status.sentCount) || status.sentCount < 0 ||
      !Number.isSafeInteger(status.auditCount) || status.auditCount < 0) throw new Error("unsupported synthetic mailbox status");
    return status;
  } finally {
    await client.close();
  }
}
