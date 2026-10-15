# Agent guide

The real application is `src/agent.ts`, invoked by `src/cli.ts`. It uses `@anthropic-ai/claude-agent-sdk` with only the local target MCP tools. `src/mcp-server.ts` exposes the narrow mailbox operation subset; `src/mailbox.ts` persists one synthetic JSON mailbox state file.

- Build with Node.js 20.19+ using `npm ci && npm run build`.
- Offline proof: `npm run check`. It tests state effects and a real MCP stdio connection without a model key.
- Normal task: `npm run mailbox -- init --seed fixtures/starter-mailbox.json --state run-output/mailbox.json`, then set `ANTHROPIC_API_KEY` and run `npm run mailbox -- ask --state run-output/mailbox.json --request "Find the October invoice"`.
- Configuration: `AGENT_MODEL` or `--model` selects Claude; `--allow-send` and `--allow-label` authorize those write operations for that invocation. A request ID can be fixed with `--request-id` to make retries idempotent.
- Dependency boundary: the server is a local stdio child process. It implements only search, get, label and synthetic send; it never connects to Gmail or any remote mailbox. `--state` must point to a file marked `synthetic: true`.
- State/reset: copy a fixture to a new state path. Each case path is owned by its invocation; do not run two writers against one path. The CLI does not reset or delete files automatically.
- Completion: the model result event is the task completion signal. The CLI then rereads the mailbox and emits final JSON; a failed model request exits nonzero.
- Evidence: final answer, model, reported cost if available, state counts and the state file's sent/audit entries. No recorded live model result exists yet.
- Keep provider credentials out of target MCP and Git. Do not present this subset as full Gmail compatibility or use old Firedrill drills. A new Firedrill connection remains pending verification of the released interface.
