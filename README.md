# Synthetic inbox agent with Claude Agent SDK and MCP

This standalone TypeScript command-line application lets a Claude agent search and read messages, label a message, and send a message inside a fictional mailbox. The model chooses the MCP calls; the mailbox service persists actual state changes and a small action audit. It supports an owned stdio child process or an explicitly selected authenticated HTTP MCP endpoint. It does not connect to Gmail or deliver real email. The target MCP service implements a narrow Gmail-style operation subset.

## Simulate with Firedrill

[Firedrill](https://firedrill.run/) is a simulation platform for AI agents.
Start from this repository’s root:

```sh
npx firedrill-run init
```

Sign in and choose your project, then follow the [simulation run guide](firedrill/README.md)
for application dependencies, a preview and the reviewed scenarios. Your agent runs
locally or in your CI; model credentials stay separate from Firedrill sign-in.
The included recipes record outcomes without an automatic quality score or CI gate.

## Run an ordinary task

Requires Node.js 20.19+ and an Anthropic API key for model requests:

```sh
npm ci
npm run build
npm run mailbox -- list
npm run mailbox -- init --case starter-mailbox --state run-output/mailbox.json
export ANTHROPIC_API_KEY='your-key-from-a-secret-manager'
npm run mailbox -- ask --state run-output/mailbox.json --request "Find the October invoice and summarize it"
```

The CLI accepts exactly one completed SDK result: `subtype=success`, `is_error=false`, nonblank answer, no queued/deferred turn, and no known unfinished stop reason. A result labelled success can still contain an API error; it is rejected. `AGENT_MODEL` or `--model` changes the Claude model. Requests stop at 12 turns, a three-minute abort deadline, or the SDK's USD 1 estimated-budget threshold. The threshold is not a billing cap and can be exceeded by an in-flight call. Aborting includes the SDK's shutdown grace period; it does not roll back committed mailbox actions. A missing key stops before any SDK child is created.

Successful JSON includes the answer, requested model, selected transport, state counts and an `observation`: request/prompt hashes, initial/final state hashes and dataset metadata, plus the SDK result with session ID, per-model `modelUsage`, main-loop `usage`, permission denials and stop reason. `costUsd` is the SDK's estimate, not provider billing evidence. `modelUsage` is cumulative across the query pipeline; do not sum it with the narrower main-loop usage. Missing counters or estimates remain missing/null. A failure can follow a committed send: JSON stderr retains the available SDK result and final state, with no success stdout. If final state cannot be read, it stays null with a read-error marker; this is not proof of rollback. Failure exits `1`.

The agent uses an empty temporary working directory, `persistSession=false`, no user/project setting sources, no built-in Claude tools and strict explicit MCP configuration. Its Query closes on success, failure or abort, and the working directory is removed. This controls application/session behavior; it is not an OS sandbox. The provider call may incur cost; no automatic repetition campaign is included.

Sending and labeling need explicit CLI switches. For example, an authorized synthetic send can use `--allow-send --request-id review-1002`; retry the same request ID against the same state file to test duplicate prevention. The runtime permission callback rejects a send whose tool request ID differs from the caller's ID; a model cannot create a second delivery by choosing another ID. The MCP server rejects recipients outside the fixture allowlist and can simulate a delivery failure. It never falls back to a production mailbox. Built-in Claude Code tools and user/project settings are disabled for this application.

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

Choose exactly one of `--state` (stdio) or `--mcp-url` (HTTP). The HTTP client requires HTTPS outside loopback, refuses credentials/query/fragment in the URL, checks the server identity, synthetic-state marker and evidence fields before starting the model, and never switches to a local or production fallback. The server and the agent invocation must both authorize a write: starting a read-only server keeps send/label tools unavailable even if a client asks for them. `--allow-send` on the server enables synthetic sends; it does not deliver real email.

For a service on another machine, deploy this same synthetic service behind a caller-managed TLS proxy, preserving the bearer header and using a loopback upstream Host. Such a deployment is not part of the local proof; TLS termination, access control and service lifecycle remain the caller's responsibility. This is a static bearer-token example, with no OAuth discovery or token refresh. Stop the service with SIGINT/SIGTERM; the asking agent does not own or stop it. Keep cases in separate service instances/state files and run tasks sequentially within one mailbox.

| Operation | Arguments | Effect |
|---|---|---|
| `mailbox_status` | none | Read format version, message/send/audit counts, current state hash and declared dataset metadata |
| `search_messages` | `query` | Read up to 20 message summaries; no pagination |
| `get_message` | `message_id` | Read one exact message or return a tool error |
| `add_label` | `message_id`, supported `label` | Persist a label and audit entry; requires server authorization |
| `send_message` | `to`, `subject`, `body`, `request_id` | Persist one allowlisted synthetic send; matching retries return the original send, altered retries or blocked recipients return tool errors |

There is no draft, attachment, delete, Gmail authentication, arbitrary vendor API, or mailbox synchronization support. The CLI records the selected transport and reads final counts from the selected state source. A model or final state-read failure exits nonzero; inspect the owned state/audit before retrying a possibly completed action with its original request ID.

## Versioned scenarios and state

`fixtures/manifest.json` defines `northstar-mailbox` version `1.0.0`: six distinct mailbox snapshots across all four profiles. The starter has an invoice and similar contacts; the busy mailbox has 24 messages in eight threads and an existing sent message; the ambiguous mailbox has equally plausible recipients and unresolved invoice evidence. Boundary snapshots cover blocked delivery, hostile message text and an already completed send. All addresses are fictional `.example` identities. See [scenario briefs](scenarios/README.md).

`mailbox list` validates every manifest digest without a model/key. `init --case CASE --state PATH` verifies the selected snapshot's hash, structure and declared identity, then copies exactly those bytes to a fresh private file. `--manifest PATH` supports an explicit alternate population. Unknown cases, drift, duplicate identities and path/symlink escapes fail. `init --seed PATH` remains available for caller-owned custom synthetic data; it validates the state but does not certify it against the committed manifest. `node scripts/make-fixtures.mjs` reproduces the committed snapshots/hashes. Qualify a new version when changing input data.

Create a **new state path** for each case; `init` uses exclusive creation and refuses to overwrite an existing file. Messages, historical sends and blocked recipients must have consistent identities/relationships. Independent cases require independent paths, and two writers must not share one path concurrently. Atomic file replacement protects individual writes but provides no concurrent-writer lock. Initial/final hashes describe the bytes actually observed, including any earlier actions; a declared dataset label alone does not prove pristine seed state. Delete a run's copy when no longer needed; committed fixtures are unchanged.

## Offline checks and CI

```sh
npm ci
npm run check
```

The 35 offline checks compile TypeScript, connect actual MCP clients over stdio/HTTP, and use the actual Claude Agent SDK `query` protocol with a test-only synthetic child supplied through its supported spawn hook. SDK tests cover API errors inside success results, unfinished completion, exact send-ID permissions, retained failure usage/state, session cleanup and abort. They do not run Claude Code's model loop or prove model-directed tool choices. Existing MCP proofs cover persisted label/send effects, duplicate prevention, bearer/Host/Origin rejection, server-side read-only enforcement, older MCP requests, unavailable endpoints and CLI readiness/shutdown. Dataset/CLI checks cover coherent profiles, byte-for-byte reproduction in a temporary root, drift and fresh-path reset. No provider request occurs. Live Claude judgment and hosted-endpoint proof remain pending an authorized key/account. Direct versions: Claude Agent SDK `0.3.300`, MCP server/client `2.3.1`, MCP Node adapter `2.1.1` and Zod `4.6.7`; exact resolved dependencies are in `package-lock.json`.

## Firedrill boundary

The intended connection is the one-request CLI plus a per-case state file and its owned MCP child process, or an explicitly supplied HTTP MCP endpoint whose process and reset are caller-owned. The included [Firedrill integration](firedrill/README.md) uses this CLI and its owned synthetic mailbox MCP. Authenticated persisted reports and live CI remain unverified. No retired `firedrill.json`, drill command or unsupported Gmail compatibility claim is included.

The repository is private and unlicensed pending the portfolio's publication decision. Current implementation references: [Claude Agent SDK MCP guide](https://code.claude.com/docs/en/agent-sdk/mcp), [MCP TypeScript stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md) and [HTTP serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.

## Current Firedrill connection — 2026-10-19

The [agent-first integration](firedrill/README.md) pins CLI/SDK 2.2.2 and connects the actual inbox CLI, Claude Agent SDK and local synthetic target MCP with separate private mailbox state per invocation. The remote Firedrill operator MCP has a separate role and authorization. Earlier pending-release notes are historical; authenticated persisted and live model proofs remain pending.
