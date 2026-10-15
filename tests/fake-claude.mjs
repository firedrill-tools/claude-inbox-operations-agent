// Test-only child protocol: no provider calls, SDK imports or evaluation answers.
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
const fixture = JSON.parse(process.env.INBOX_TEST_RESULT);
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let pending = false;
if (fixture.mode === "hang") setInterval(() => {}, 1000);
function finish() {
  if (fixture.mode === 'hang') return;
  if (fixture.mode !== 'no-result') send(fixture.result);
  lines.close();
  process.stdin.pause();
  setTimeout(() => process.exit(0), 10);
}
lines.on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') {
    send({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
      response: { commands: [], models: [], agents: [], account: {}, output_style: 'default', available_output_styles: ['default'] } } });
  } else if (frame.type === 'user') {
    if (fixture.permission) {
      pending = true;
      send({ type: 'control_request', request_id: 'test-permission', request: { subtype: 'can_use_tool',
        tool_name: fixture.permission.name, input: fixture.permission.input, tool_use_id: 'synthetic-tool-1', permission_suggestions: [] } });
    } else finish();
  } else if (frame.type === 'control_response' && pending) {
    fixture.result.result = JSON.stringify(frame.response);
    finish();
  }
});
