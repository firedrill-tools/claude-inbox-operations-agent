# Operate a synthetic inbox with the Claude Agent SDK and MCP

This standalone command-line application lets a Claude agent search and read messages, label a message, and send a message inside a fictional local mailbox. The model chooses the MCP calls; the mailbox service persists actual state changes and a small action audit. It does not connect to Gmail or deliver real email. The separate target MCP process is a narrow Gmail-style operation subset, not a Gmail API clone.

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

## Scenarios and state

The fixtures in `fixtures/` contain coherent fictional contacts, an invoice thread, and a separate blocked-delivery case. See [scenarios/README.md](scenarios/README.md) for five meaningful situations. Create a **new state path** for each case; `init` refuses to overwrite an existing file. Independent cases require independent paths, and two writers must not share one path concurrently. The state file is the source of truth for sent items, labels, and audit entries. Delete a run's copy when no longer needed; the committed fixtures are unchanged.

## Offline checks and CI

```sh
npm ci
npm run check
```

The offline checks compile TypeScript, test idempotent and failed synthetic sends, and connect an MCP client to the actual stdio server. They make no model request. A live Claude run and its observed results remain to be recorded with an authorized API key.

## Firedrill boundary

The intended connection is the one-request CLI plus a per-case state file and its owned MCP child process. A new Firedrill integration, persisted report and noninteractive CI recipe are pending verification of the released interface. No retired `firedrill.json`, drill command or unsupported Gmail compatibility claim is included.

The repository is private and unlicensed pending the portfolio's publication decision. Current implementation references: [Claude Agent SDK MCP guide](https://code.claude.com/docs/en/agent-sdk/mcp) and [MCP TypeScript stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md).
