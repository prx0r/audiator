import fs from 'node:fs';
import path from 'node:path';
import { createInitialOutlookState } from '../lib/mvp/sim-graph/outlook-work-offline.ts';
import { runScenarioTurn } from '../lib/mvp/sim-graph/runtime.ts';

const fixtureArg = process.argv[2];
const fixtureFiles = fixtureArg
  ? [path.resolve(process.cwd(), fixtureArg)]
  : [
      'tests/fixtures/calls/outlook-happy-path.json',
      'tests/fixtures/calls/outlook-bad-path.json',
      'tests/fixtures/calls/outlook-off-topic.json',
    ].map((file) => path.resolve(process.cwd(), file));

let failed = false;

for (const file of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  let state = createInitialOutlookState();
  const route = [];
  let maxPressure = state.pressure;
  let redFlags = 0;

  for (const candidateText of fixture.turns) {
    const result = runScenarioTurn({ candidateText, state });
    state = result.stateAfter;
    route.push({ candidateText, matchedNodes: result.decision.matchedNodes, reply: result.decision.customerResponseText, pressure: state.pressure });
    maxPressure = Math.max(maxPressure, state.pressure);
    redFlags += result.decision.evidenceTags.filter((tag) => tag.includes('bad') || tag.includes('bizarre') || tag.includes('destructive') || tag.includes('escalated')).length;
  }

  const summary = { name: fixture.name, issueResolved: state.issueResolved, finalPressure: state.pressure, maxPressure, redFlags, route };
  const expect = fixture.expect ?? {};
  const errors = [];
  if (typeof expect.issueResolved === 'boolean' && state.issueResolved !== expect.issueResolved) errors.push(`issueResolved expected ${expect.issueResolved}`);
  if (typeof expect.maxPressure === 'number' && maxPressure > expect.maxPressure) errors.push(`maxPressure ${maxPressure} > ${expect.maxPressure}`);
  if (typeof expect.minRedFlags === 'number' && redFlags < expect.minRedFlags) errors.push(`redFlags ${redFlags} < ${expect.minRedFlags}`);

  console.log(JSON.stringify({ ...summary, pass: errors.length === 0, errors }, null, 2));
  if (errors.length) failed = true;
}

process.exit(failed ? 1 : 0);
