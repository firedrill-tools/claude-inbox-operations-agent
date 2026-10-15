import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMailboxServer, type MailboxPermissions } from "./mcp-tools.js";
import { loadState } from "./mailbox.js";

export function validateToken(token: string): void {
  if (token.length < 32 || /\s/.test(token)) throw new Error("MAILBOX_MCP_TOKEN must contain at least 32 non-whitespace characters");
}

export async function startMailboxHttp(options: MailboxPermissions & { statePath: string; token: string; port?: number }) {
  validateToken(options.token);
  loadState(options.statePath);
  const port = options.port ?? 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be an integer from 0 to 65535");
  const handler = createMcpHandler(() => createMailboxServer(options.statePath, options));
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: 64 * 1024 });
  const validHost = localhostHostValidation();
  const validOrigin = localhostOriginValidation();
  const expected = Buffer.from(`Bearer ${options.token}`);
  const server = createServer((req, res) => {
    if (!validHost(req, res) || !validOrigin(req, res)) return;
    if (req.url !== "/mcp") { res.writeHead(404).end(); return; }
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401, { "WWW-Authenticate": 'Bearer realm="synthetic-mailbox"' }).end();
      return;
    }
    void nodeHandler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server has no listening address");
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => closing ??= (async () => {
      await handler.close();
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    })(),
  };
}
