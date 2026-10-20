# Simulate this agent with Firedrill

Firedrill is a simulation platform for AI agents. Your coding agent can prepare
and operate these simulations; the application and its model run in your own
repository or CI.

Start in the repository root, not inside `firedrill/`:

```sh
npx firedrill-run init
```

Authorize Firedrill and select a project/environment. Installation choices are
optional; skip them when using the locked `firedrill/` toolchain below. This setup
does not invoke the target agent or grant it access to real business accounts.

This optional execution toolchain pins released CLI and TypeScript SDK **2.2.2**, verified October 19, 2026. It requires Node 22+; the application's existing Claude Agent SDK and target MCP dependencies remain separately locked.

## Prepare

From the repository root:

```sh
npm ci
npm run build
npm ci --prefix firedrill --ignore-scripts --no-audit --no-fund
firedrill_cli=firedrill/node_modules/@firedrill-run/cli/bin/firedrill.mjs
node "$firedrill_cli" validate firedrill/scenario.json --json --non-interactive
```

Offline validation allocates no batch. Tests cover the released validator, invocation format, process failures/cancellation, private case preservation and actual CLI missing-key failure. The existing application checks exercise real MCP and SDK protocol traffic with controlled test children, not paid Claude output.

## Select scope and execute

Run `npx firedrill-run init` in a human terminal to authorize and select the actual project/environment. Automation supplies `FIREDRILL_TOKEN`, `FIREDRILL_PROJECT_ID` and `FIREDRILL_ENVIRONMENT_ID` through its secret store. The application independently needs `ANTHROPIC_API_KEY` and an enabled `AGENT_MODEL` or recipe `configuration.parameters.model`. Keep credentials out of recipes and Git.

With an authorized provider budget:

```sh
node firedrill/simulate.mjs --preview
node "$firedrill_cli" simulate firedrill/scenario.json --scenario starter-mailbox --json --non-interactive
```

The adapter initializes a private hash-bound mailbox and invokes the actual `dist/src/cli.js ask` path. The Claude Agent SDK uses the application's existing owned stdio mailbox MCP child. Requests and caller-owned IDs stay explicit; the model cannot grant label/send permission. These read-only recipes use no production Gmail connection and no Firedrill synthetic Tool binding.

The full recipe contains ordinary and ambiguous mailboxes, one repetition and concurrency one. SDK execution with `node firedrill/simulate.mjs` uses that same recipe. The application's turn/deadline/estimated-budget bounds remain in force and are not billing guarantees.

Each invocation retains a distinct `.runs/firedrill/attempt-*` directory after success, interruption or failure. New work never resets an earlier mailbox. Errors include that directory for inspection. Preserve application output/observations and inspect actual mailbox state; technical completion is distinct from task correctness. State reset does not erase provider retention or billing.

## Two different MCP roles

The local mailbox MCP is a dependency used by the target agent. Firedrill's **operator MCP** is the remote OAuth endpoint **https://mcp.firedrill.run/mcp**, configured with the [host-specific setup](https://docs.firedrill.run/guides/coding-agents). It needs no local Firedrill MCP package. Host OAuth and CLI/SDK login are separate. Operator MCP can prepare, queue and inspect, while a local CLI/SDK runner executes the application. Attach an existing batch with `node firedrill/simulate.mjs --run BATCH_ID`.

The target envelope uses `2026-10-17-target-invocation.1`, ID-only scenario context and explicit case/request input. Controller checks/rubrics and unsupported Tool bindings are rejected; operator/CI credentials are removed before application dispatch. The result contains the actual CLI output under `application` and the runner-local state paths under `localState`; a path is not an uploaded artifact. Failed partial stdout/stderr remains failure evidence.

Preserve operation IDs and private journals after uncertainty. Use `--resume OPERATION_ID` for that execution or `--result BATCH_ID` for a retained read; a fresh simulation is new work. Runner exit codes preserve pending work/assessment, errors and optional gates. This observation-only recipe requests no evaluation or gate.

Ordinary CI is offline. Use the [live CI generator](https://docs.firedrill.run/guides/ci) only after actual scope, protected secrets and budgets are configured. Authenticated persisted happy/negative runs, live Claude quality/cost, hosted target-MCP qualification, and licensing remain separate gates.

References: [SDK](https://docs.firedrill.run/sdk/typescript), [command targets](https://docs.firedrill.run/guides/callbacks), [operator MCP](https://docs.firedrill.run/guides/control-mcp).

Before application dispatch, each private workspace saves the validated outer run/attempt/scenario IDs in `invocation.json`. This maps interrupted runs to local state; it is separate from the SDK recovery journal and grants no application authority.

## Offline verification

After installing the application dependencies and locked integration toolchain,
run `npm test --prefix firedrill` to exercise the adapter checks. These checks are
optional for first use and call no paid model. The Node 22+ requirement above is
for the Firedrill clients; it does not lower any application runtime requirement
in the root README.
