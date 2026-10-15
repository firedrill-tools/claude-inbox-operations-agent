import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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

export interface MailboxState {
  synthetic: true;
  version: 1;
  mailboxOwner: string;
  allowedRecipients: string[];
  blockedRecipients: string[];
  messages: Message[];
  sent: SentMessage[];
  audit: AuditEntry[];
}

export function loadState(path: string): MailboxState {
  const state: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!state || typeof state !== "object" || !("synthetic" in state) || state.synthetic !== true) {
    throw new Error("Only a synthetic mailbox state file is supported");
  }
  const mailbox = state as MailboxState;
  if (mailbox.version !== 1 || !Array.isArray(mailbox.messages) || !Array.isArray(mailbox.sent) || !Array.isArray(mailbox.audit)) {
    throw new Error("Unsupported synthetic mailbox state format");
  }
  return mailbox;
}

export function saveState(path: string, state: MailboxState): void {
  const temp = join(dirname(path), `.mailbox-${randomUUID()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
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
    const sent: SentMessage = { id: `sent-${state.sent.length + 1}`, to, subject, body, requestId };
    state.sent.push(sent);
    state.audit.push({ operation: "send_message", target: to, result: "success" });
    saveState(this.path, state);
    return sent;
  }
}
