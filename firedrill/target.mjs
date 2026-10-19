import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApplicationError, commandMain, invokeCLI, privateDirectory } from './adapter-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = new Set(['starter-mailbox', 'ambiguous-mailbox']);

export async function runApplication(input, parameters, signal, invocation) {
  if (Object.keys(input).some(key => !['caseId', 'request'].includes(key)) || !cases.has(input.caseId) ||
      typeof input.request !== 'string' || !input.request.trim() || input.request.length > 12000) {
    throw new Error('Select a reviewed mailbox case and an explicit bounded request.');
  }
  const directory = await privateDirectory(root, invocation);
  const state = join(directory, 'mailbox.json');
  const cli = [process.execPath, 'dist/src/cli.js'];
  try {
    await invokeCLI([...cli, 'init', '--case', input.caseId, '--state', state], { cwd: root, signal });
    const argv = [...cli, 'ask', '--state', state, '--request', input.request, '--request-id', randomUUID()];
    if (parameters.model) argv.push('--model', parameters.model);
    // The recipe grants no label/send or real-account capability.
    const output = await invokeCLI(argv, { cwd: root, signal });
    return { application: output, localState: { directory, mailboxFile: state } };
  } catch (error) {
    if (error instanceof ApplicationError) error.evidence.runDirectory = directory;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await commandMain(runApplication);
}
