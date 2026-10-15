# Operate a synthetic inbox with the Claude Agent SDK and MCP

This standalone TypeScript command-line application lets a Claude agent search and read messages, label a message, and send a message inside a fictional mailbox. The model chooses the MCP calls; the mailbox service persists actual state changes and a small action audit. It supports an owned stdio child process or an explicitly selected authenticated HTTP MCP endpoint. It does not connect to Gmail or deliver real email. The target MCP service implements a narrow Gmail-style operation subset.

## Run an ordinary task

Requires Node.js 20.19+ and an Anthropic API key for model requests:

```sh
npm ci
npm run build
npm run mailbox -- init --seed fixtures/starter-mailbox.json --state run-output/mailbox.json
export ANTHROPIC_API_KEY='your-key-from-a-secret-manager'
npm run mailbox -- ask --state run-output/mailbox.json --request "Find the October invoice and summarize it"
```

The CLI prints JSON after the Agent SDK result event, including its answer, model, provider-reported cost if available, and sent/audit counts. `AGENT_MODEL` or `--model` changes the Claude model. The model call may incur provider cost. A missing key stops before the model call.

Sending and labeling need explicit CLI switches. For example, an authorized synthetic send can use `--allow-send --request-id review-1002`; retry the same request ID against the same state file to test duplicate prevention. The MCP server rejects recipients outside the fixture allowlist and can simulate a delivery failure. It never falls back to a production mailbox. Built-in Claude Code tools and user/project settings are disabled for this application.

## Use an HTTP MCP endpoint

The same mailbox tools can run in a separate, caller-owned HTTP service. In the server terminal, set `MAILBOX_MCP_TOKEN` to at least 32 random non-whitespace characters from your secret manager, then start one fixture copy:

```sh
npm run mailbox -- init --seed fixtures/starter-mailbox.json --state run-output/http-mailbox.json
npm run mailbox -- serve --state run-output/http-mailbox.json --port 8787 --allow-label
```

The ready JSON contains `http://127.0.0.1:8787/mcp`; it never prints the token. The listener binds loopback and validates Host, Origin and the bearer token. In a second terminal with the **same** `MAILBOX_MCP_TOKEN` and an Anthropic key, run:

```sh
npm run mailbox -- ask --mcp-url http://127.0.0.1:8787/mcp \
  --allow-label --request "Label the October invoice for follow-up"
```

Choose exactly one of `--state` (stdio) or `--mcp-url` (HTTP). The HTTP client requires HTTPS outside loopback, refuses credentials/query/fragment in the URL, checks the server identity and synthetic-state marker before starting the model, and never switches to a local or production fallback. The server and the agent invocation must both authorize a write: starting a read-only server keeps send/label tools unavailable even if a client asks for them. `--allow-send` on the server enables synthetic sends; it does not deliver real email.

For a service on another machine, deploy this same synthetic service behind a caller-managed TLS proxy, preserving the bearer header and using a loopback upstream Host. Such a deployment is not part of the local proof; TLS termination, access control and service lifecycle remain the caller's responsibility. This is a static bearer-token example, with no OAuth discovery or token refresh. Stop the service with SIGINT/SIGTERM; the asking agent does not own or stop it. Keep cases in separate service instances/state files and run tasks sequentially within one mailbox.

| Operation | Arguments | Effect |
|---|---|---|
| `mailbox_status` | none | Read synthetic format version and persisted send/audit counts |
| `search_messages` | `query` | Read up to 20 message summaries; no pagination |
| `get_message` | `message_id` | Read one exact message or return a tool error |
| `add_label` | `message_id`, supported `label` | Persist a label and audit entry; requires server authorization |
| `send_message` | `to`, `subject`, `body`, `request_id` | Persist one allowlisted synthetic send; matching retries return the original send, altered retries or blocked recipients return tool errors |

There is no draft, attachment, delete, Gmail authentication, arbitrary vendor API, or mailbox synchronization support. The CLI records the selected transport and reads final counts from the selected state source. A model or final state-read failure exits nonzero; inspect the owned state/audit before retrying a possibly completed action with its original request ID.

## Scenarios and state

The fixtures in `fixtures/` contain coherent fictional contacts, an invoice thread, and a separate blocked-delivery case. See [scenarios/README.md](scenarios/README.md) for seven meaningful situations. Create a **new state path** for each case; `init` refuses to overwrite an existing file. Independent cases require independent paths, and two writers must not share one path concurrently. The state file is the source of truth for sent items, labels, and audit entries. Delete a run's copy when no longer needed; the committed fixtures are unchanged.

## Offline checks and CI

```sh
npm ci
npm run check
```

The 11 offline checks compile TypeScript, test idempotent and failed synthetic sends, and connect actual MCP clients over stdio and HTTP. HTTP evidence includes persisted label/send effects, duplicate prevention, missing/wrong credentials, Host/Origin rejection, server-side read-only enforcement, older MCP requests, unavailable endpoints and CLI readiness/shutdown. They make no model request. A live Claude run and its observed results remain to be recorded with an authorized API key. Direct versions: Claude Agent SDK `0.3.300`, MCP server/client `2.3.1`, MCP Node adapter `2.1.1` and Zod `4.6.7`; exact resolved dependencies are in `package-lock.json`.

## Firedrill boundary

The intended connection is the one-request CLI plus a per-case state file and its owned MCP child process, or an explicitly supplied HTTP MCP endpoint whose process and reset are caller-owned. A new Firedrill integration, persisted report and noninteractive CI recipe are pending verification of the released interface. No retired `firedrill.json`, drill command or unsupported Gmail compatibility claim is included.

The repository is private and unlicensed pending the portfolio's publication decision. Current implementation references: [Claude Agent SDK MCP guide](https://code.claude.com/docs/en/agent-sdk/mcp), [MCP TypeScript stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md) and [HTTP serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
