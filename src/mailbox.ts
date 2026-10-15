import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod/v4";

export interface Message {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  labels: string[];
  receivedAt: string;
}

export interface SentMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  requestId: string;
}

export interface AuditEntry {
  operation: string;
  target: string;
  result: "success" | "rejected" | "duplicate";
}

export const datasetSchema = z.object({
  datasetId: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  profile: z.enum(["starter", "busy", "ambiguous", "boundary"]), caseId: z.string().min(1),
}).strict();
export type DatasetMetadata = z.infer<typeof datasetSchema>;

export interface MailboxState {
  synthetic: true;
  version: 1;
  dataset?: DatasetMetadata;
  mailboxOwner: string;
  allowedRecipients: string[];
  blockedRecipients: string[];
  messages: Message[];
  sent: SentMessage[];
  audit: AuditEntry[];
}

const stateSchema = z.object({
  synthetic: z.literal(true), version: z.literal(1), dataset: datasetSchema.optional(), mailboxOwner: z.email(),
  allowedRecipients: z.array(z.email()), blockedRecipients: z.array(z.email()),
  messages: z.array(z.object({ id: z.string().min(1), from: z.email(), to: z.email(), subject: z.string(),
    body: z.string(), labels: z.array(z.enum(["inbox", "important", "followup", "archived", "read"])),
    receivedAt: z.iso.datetime() }).strict()),
  sent: z.array(z.object({ id: z.string().min(1), to: z.email(), subject: z.string().min(1).max(300),
    body: z.string().min(1).max(10000), requestId: z.string().min(1).max(100) }).strict()),
  audit: z.array(z.object({ operation: z.enum(["send_message", "add_label"]), target: z.string().min(1),
    result: z.enum(["success", "rejected", "duplicate"]) }).strict()),
}).strict().superRefine((state, context) => {
  const unique = (items: string[]) => new Set(items).size === items.length;
  if (!unique(state.messages.map(item => item.id)) || !unique(state.sent.map(item => item.id)) ||
      !unique(state.sent.map(item => item.requestId)) || !unique(state.allowedRecipients) || !unique(state.blockedRecipients)) {
    context.addIssue({ code: "custom", message: "Mailbox record, recipient and request identities must be unique" });
  }
  if (state.messages.some(item => item.to !== state.mailboxOwner) ||
      state.sent.some(item => !state.allowedRecipients.includes(item.to)) ||
      state.blockedRecipients.some(item => !state.allowedRecipients.includes(item))) {
    context.addIssue({ code: "custom", message: "Mailbox ownership and recipient relationships are inconsistent" });
  }
});

export function parseState(snapshot: Buffer): MailboxState {
  if (snapshot.length > 2 * 1024 * 1024) throw new Error("Mailbox exceeds 2 MiB");
  return stateSchema.parse(JSON.parse(snapshot.toString("utf8")));
}

export function readState(path: string) {
  const snapshot = readFileSync(path);
  return { state: parseState(snapshot), sha256: createHash("sha256").update(snapshot).digest("hex"), snapshot };
}

export function loadState(path: string): MailboxState {
  return readState(path).state;
}

export function saveState(path: string, state: MailboxState): void {
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  parseState(Buffer.from(serialized));
  const temp = join(dirname(path), `.mailbox-${randomUUID()}.tmp`);
  writeFileSync(temp, serialized, { flag: "wx", mode: 0o600 });
  renameSync(temp, path);
}

export class Mailbox {
  constructor(private readonly path: string) {
    loadState(path);
  }

  search(query: string): Omit<Message, "body">[] {
    const term = query.toLowerCase().trim();
    return loadState(this.path).messages
      .filter((message) => `${message.from} ${message.to} ${message.subject} ${message.body}`.toLowerCase().includes(term))
      .slice(0, 20)
      .map(({ body: _body, ...summary }) => summary);
  }

  read(messageId: string): Message | null {
    return loadState(this.path).messages.find((message) => message.id === messageId) ?? null;
  }

  addLabel(messageId: string, label: string): { messageId: string; labels: string[] } | null {
    const state = loadState(this.path);
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) return null;
    if (!message.labels.includes(label)) message.labels.push(label);
    state.audit.push({ operation: "add_label", target: messageId, result: "success" });
    saveState(this.path, state);
    return { messageId, labels: message.labels };
  }

  send(to: string, subject: string, body: string, requestId: string): SentMessage | { error: string } {
    const state = loadState(this.path);
    const existing = state.sent.find((item) => item.requestId === requestId);
    if (existing) {
      if (existing.to !== to || existing.subject !== subject || existing.body !== body) {
        state.audit.push({ operation: "send_message", target: to, result: "rejected" });
        saveState(this.path, state);
        return { error: "request ID was already used for a different message" };
      }
      state.audit.push({ operation: "send_message", target: to, result: "duplicate" });
      saveState(this.path, state);
      return existing;
    }
    if (!state.allowedRecipients.includes(to)) {
      state.audit.push({ operation: "send_message", target: to, result: "rejected" });
      saveState(this.path, state);
      return { error: "recipient is outside this synthetic mailbox" };
    }
    if (state.blockedRecipients.includes(to)) {
      state.audit.push({ operation: "send_message", target: to, result: "rejected" });
      saveState(this.path, state);
      return { error: "synthetic delivery temporarily failed" };
    }
    const sent: SentMessage = { id: `sent-${randomUUID()}`, to, subject, body, requestId };
    state.sent.push(sent);
    state.audit.push({ operation: "send_message", target: to, result: "success" });
    saveState(this.path, state);
    return sent;
  }
}
