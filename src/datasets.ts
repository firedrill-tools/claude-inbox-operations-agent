import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { parseState } from "./mailbox.js";

export const DEFAULT_MANIFEST = fileURLToPath(new URL("../../fixtures/manifest.json", import.meta.url));
const profile = z.enum(["starter", "busy", "ambiguous", "boundary"]);
const manifestSchema = z.object({ datasetId: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  profiles: z.array(z.object({ name: profile, cases: z.array(z.object({
    caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).min(1) }).strict()),
}).strict().superRefine((manifest, context) => {
  const cases = manifest.profiles.flatMap(item => item.cases);
  if (manifest.profiles.map(item => item.name).sort().join(",") !== "ambiguous,boundary,busy,starter" ||
      new Set(cases.map(item => item.caseId)).size !== cases.length || new Set(cases.map(item => item.path)).size !== cases.length) {
    context.addIssue({ code: "custom", message: "Manifest needs four profiles and unique case/source identities" });
  }
});

function manifest(path: string) {
  const snapshot = readFileSync(path);
  if (snapshot.length > 128 * 1024) throw new Error("Manifest exceeds 128 KiB");
  return manifestSchema.parse(JSON.parse(snapshot.toString("utf8")));
}

export function selectCase(caseId: string, path = DEFAULT_MANIFEST) {
  const population = manifest(path);
  const root = realpathSync(dirname(path));
  for (const group of population.profiles) for (const entry of group.cases) {
    if (entry.caseId !== caseId) continue;
    const source = realpathSync(resolve(root, entry.path));
    const location = relative(root, source);
    if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error("Dataset source escapes its manifest directory");
    const snapshot = readFileSync(source);
    const digest = createHash("sha256").update(snapshot).digest("hex");
    if (digest !== entry.sha256) throw new Error(`Dataset digest mismatch for ${caseId}; qualify a new version`);
    const state = parseState(snapshot);
    const dataset = { datasetId: population.datasetId, version: population.version, profile: group.name, caseId };
    if (JSON.stringify(state.dataset) !== JSON.stringify(dataset)) throw new Error("Mailbox dataset identity disagrees with manifest");
    return { source, snapshot, sha256: digest, dataset, state };
  }
  throw new Error(`Dataset case not found: ${caseId}`);
}

export function listCases(path = DEFAULT_MANIFEST) {
  const population = manifest(path);
  for (const group of population.profiles) for (const entry of group.cases) selectCase(entry.caseId, path);
  return { datasetId: population.datasetId, version: population.version,
    caseCount: population.profiles.reduce((sum, group) => sum + group.cases.length, 0),
    profiles: population.profiles.map(group => ({ name: group.name, caseIds: group.cases.map(entry => entry.caseId) })) };
}
