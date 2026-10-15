import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { Mailbox, loadState } from "./mailbox.js";

export interface MailboxPermissions {
  allowSend: boolean;
  allowLabel: boolean;
}

export function mailboxStatus(statePath: string) {
  const state = loadState(statePath);
  return { synthetic: true, version: 1, sentCount: state.sent.length, auditCount: state.audit.length };
}

export function createMailboxServer(statePath: string, permissions: MailboxPermissions): McpServer {
  const mailbox = new Mailbox(statePath);
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
  const server = new McpServer({ name: "synthetic-mailbox", version: "0.2.0" });

  server.registerTool("mailbox_status", {
    description: "Read the synthetic mailbox format and persisted send/audit counts. This does not change state.",
    inputSchema: z.object({}),
  }, async () => result(mailboxStatus(statePath)));

  server.registerTool("search_messages", {
    description: "Search the synthetic mailbox by sender, recipient, subject, or body; returns at most 20 summaries.",
    inputSchema: z.object({ query: z.string().min(1) }),
  }, async ({ query }) => result(mailbox.search(query)));

  server.registerTool("get_message", {
    description: "Read one synthetic mailbox message by its exact ID.",
    inputSchema: z.object({ message_id: z.string().min(1) }),
  }, async ({ message_id }) => {
    const message = mailbox.read(message_id);
    return message ? result(message) : failure("message not found");
  });

  if (permissions.allowLabel) server.registerTool("add_label", {
    description: "Add one label to a synthetic message. Supported labels: important, followup, archived, read.",
    inputSchema: z.object({ message_id: z.string().min(1), label: z.enum(["important", "followup", "archived", "read"]) }),
  }, async ({ message_id, label }) => {
    const updated = mailbox.addLabel(message_id, label);
    return updated ? result(updated) : failure("message not found");
  });

  if (permissions.allowSend) server.registerTool("send_message", {
    description: "Send one message inside the synthetic mailbox only. Use the request ID supplied by the caller for retry safety.",
    inputSchema: z.object({ to: z.email(), subject: z.string().min(1).max(300), body: z.string().min(1).max(10000), request_id: z.string().min(1).max(100) }),
  }, async ({ to, subject, body, request_id }) => {
    const sent = mailbox.send(to, subject, body, request_id);
    return "error" in sent ? failure(sent.error) : result(sent);
  });
  return server;
}
