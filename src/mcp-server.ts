import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { resolve } from "node:path";
import { Mailbox } from "./mailbox.js";

function stateArgument(): string {
  const index = process.argv.indexOf("--state");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--state is required");
  return resolve(process.argv[index + 1]);
}

const mailbox = new Mailbox(stateArgument());
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function createServer(): McpServer {
  const server = new McpServer({ name: "synthetic-mailbox", version: "0.1.0" });

  server.registerTool("search_messages", {
    description: "Search the local synthetic mailbox by sender, recipient, subject, or body; returns at most 20 summaries.",
    inputSchema: z.object({ query: z.string().min(1) }),
  }, async ({ query }) => result(mailbox.search(query)));

  server.registerTool("get_message", {
    description: "Read one synthetic mailbox message by its exact ID.",
    inputSchema: z.object({ message_id: z.string().min(1) }),
  }, async ({ message_id }) => {
    const message = mailbox.read(message_id);
    return message ? result(message) : failure("message not found");
  });

  server.registerTool("add_label", {
    description: "Add one label to a synthetic message. Supported labels: important, followup, archived, read.",
    inputSchema: z.object({
      message_id: z.string().min(1),
      label: z.enum(["important", "followup", "archived", "read"]),
    }),
  }, async ({ message_id, label }) => {
    const updated = mailbox.addLabel(message_id, label);
    return updated ? result(updated) : failure("message not found");
  });

  server.registerTool("send_message", {
    description: "Send one message inside the synthetic mailbox only. Use the request ID supplied by the caller for retry safety.",
    inputSchema: z.object({
      to: z.email(),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(10000),
      request_id: z.string().min(1).max(100),
    }),
  }, async ({ to, subject, body, request_id }) => {
    const sent = mailbox.send(to, subject, body, request_id);
    return "error" in sent ? failure(sent.error) : result(sent);
  });

  return server;
}

void serveStdio(createServer);
