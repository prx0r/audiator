import { matchIntent } from '../lib/mvp/sim-graph/match-intent.ts';
import { createInitialOutlookState, outlookWorkOfflineGraph } from '../lib/mvp/sim-graph/outlook-work-offline.ts';
import { runScenarioTurn } from '../lib/mvp/sim-graph/runtime.ts';

const graph = outlookWorkOfflineGraph;

function testNode(label, utterances, expectedIntent, preconditionState) {
  const state = preconditionState ?? createInitialOutlookState();
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const text of utterances) {
    const match = matchIntent(text, graph, state);
    const matched = match.node.candidateIntent;
    const ok = matched === expectedIntent;
    if (ok) passed++; else failed++;
    results.push({
      text,
      expected: expectedIntent,
      got: matched,
      confidence: Math.round(match.confidence * 100),
      reason: match.reason,
      pass: ok,
    });
  }

  const rate = Math.round((passed / utterances.length) * 100);
  const status = rate >= 80 ? 'PASS' : rate >= 50 ? 'WARN' : 'FAIL';

  console.log(`\n[${status}] ${label} (${passed}/${utterances.length} = ${rate}%)`);
  for (const r of results) {
    const icon = r.pass ? '✓' : '✗';
    console.log(`  ${icon} "${r.text}" → ${r.got} (${r.confidence}%, ${r.reason})`);
  }

  return { passed, failed, total: utterances.length, rate, label };
}

console.log('='.repeat(70));
console.log('INTENT MATCHER COMPREHENSIVE TEST');
console.log('='.repeat(70));

const state = createInitialOutlookState();

const tests = [];

tests.push(testNode('identity_verification', [
  'Can I take your name please?',
  'Who am I speaking with?',
  'What is your name?',
  'Can I get your name?',
  'What company are you calling from?',
  'Who do I have the pleasure of speaking with?',
  'Can I start by getting your name?',
  'Hi there, can I get your details?',
  'Hello Sarah, what is your name?',
  'Can I confirm who I am speaking to?',
], 'identity_verification', state));

const stateAfterIdent = matchIntent('can I have your name', graph, state);
let s1 = createInitialOutlookState();
s1.identityVerified = true;

tests.push(testNode('ask_problem_summary', [
  'Can you tell me what is happening?',
  'What seems to be the problem?',
  'What is going on?',
  'Can you describe the issue?',
  'How can I help you today?',
  'When did this start happening?',
  'Was it working fine before?',
  'How long has this been going on?',
  'Has this happened before?',
  'What seems to be the trouble?',
  'Tell me what is wrong with Outlook',
], 'ask_problem_summary', s1));

let s2 = { ...s1, problemSummarized: true };

tests.push(testNode('ask_error_message', [
  'Do you see an error message?',
  'Is there any error on screen?',
  'What does the error say?',
  'Any error code showing?',
  'Is there a warning message?',
  'Do you see any popup?',
  'Is there an error on display?',
], 'ask_error_message', s2));

let s3 = { ...s2, errorMessageChecked: true };

tests.push(testNode('ask_outbox_status', [
  'Is it stuck in your outbox?',
  'Can you check the outbox?',
  'Does the email appear in Outbox?',
  'Where is the email now?',
  'Can you see it in the outbox?',
  'Is it sitting in the outbox?',
  'Has it left the outbox?',
  'Is it still queued in outbox?',
], 'ask_outbox_status', s3));

let s4 = { ...s3, outboxChecked: true };

tests.push(testNode('ask_internet_status', [
  'Is your internet working?',
  'Can you open a website?',
  'Can you browse the web?',
  'Are you connected to the internet?',
  'Is your wifi working?',
  'Are you online?',
  'Can you access the network?',
], 'ask_internet_status', s4));

let s5 = { ...s4, internetChecked: true };

tests.push(testNode('ask_webmail_status', [
  'Can you check webmail?',
  'Does email work in the browser?',
  'Can you send from webmail?',
  'Try logging into the web version',
  'Can you access your email online?',
  'Log into outlook webmail',
  'Can you get into webmail?',
], 'ask_webmail_status', s5));

let s6 = { ...s5, webmailChecked: true };

tests.push(testNode('ask_send_receive_status', [
  'Can you go to Send Receive?',
  'Open the Send Receive tab',
  'Can you check send and receive?',
  'Try clicking send receive',
  'Force a send and receive cycle',
  'Hit send and receive',
], 'ask_send_receive_status', s6));

let s7 = { ...s6, sendReceiveChecked: true };

tests.push(testNode('ask_work_offline_status', [
  'Is Work Offline highlighted?',
  'Can you check if Work Offline is selected?',
  'Is the Work Offline button on?',
  'Check the status bar for Work Offline',
  'Look if Work Offline is active',
  'Can you see Work Offline in the bottom?',
], 'ask_work_offline_status', s7));

let s8 = { ...s7, workOfflineChecked: true, workOfflineFound: true };

tests.push(testNode('disable_work_offline', [
  'Click Work Offline to turn it off',
  'Disable Work Offline',
  'Unselect the Work Offline button',
  'Switch off Work Offline',
  'Turn off the Work Offline setting',
  'Click it to disable it',
  'Deselect Work Offline',
], 'disable_work_offline', s8));

let s9 = { ...s8, workOfflineDisabled: true };

tests.push(testNode('send_test_email', [
  'Try sending a test email',
  'Can you send the email now?',
  'Please send a test message',
  'Try to send it again',
  'Attempt to send the email now',
  'Go ahead and try sending',
  'Send a test to check',
], 'send_test_email', s9));

let s10 = { ...s9, testEmailSent: true };

tests.push(testNode('confirm_resolution', [
  'Has that fixed the issue?',
  'Is everything working now?',
  'Can I confirm that resolved it?',
  'Are you good now?',
  'Did that solve your problem?',
  'Is it all sorted?',
  'Has that sorted it out?',
], 'confirm_resolution', s10));

// Negative tests
let sNeg = createInitialOutlookState();

tests.push(testNode('bad_reinstall_outlook', [
  'We need to reinstall Outlook',
  'Uninstall Outlook',
  'Rebuild your Outlook profile',
  'Reset Outlook',
  'Remove Office and reinstall',
], 'bad_reinstall_outlook', sNeg));

tests.push(testNode('bad_escalate_too_early', [
  'I need to escalate this',
  'I am going to transfer you to a specialist',
  'This is beyond my remit',
  'Someone senior needs to handle this',
], 'bad_escalate_too_early', sNeg));

tests.push(testNode('off_topic_bizarre', [
  'Maybe aliens broke Outlook',
  'It could be ghosts',
  'This is a government conspiracy',
], 'off_topic_bizarre', sNeg));

tests.push(testNode('small_talk', [
  'I understand the meeting is urgent',
  'I appreciate your patience',
  'I am sorry you are having trouble',
  'This must be frustrating',
], 'small_talk', sNeg));

// Edge cases - things that should NOT match wrong intents
const edgeTests = [
  { text: 'try sending a test email', shouldNot: 'ask_webmail_status', desc: 'test email before precondition met' },
  { text: 'my internet is slow', shouldNot: 'ask_internet_status', desc: 'slow internet not diagnostic' },
  { text: 'can you send that again', shouldNot: 'ask_send_receive_status', desc: 'send again not send/receive tab' },
  { text: 'click the button', shouldNot: 'send_test_email', desc: 'generic click not test email' },
];

console.log('\n' + '='.repeat(70));
console.log('EDGE CASE TESTS');
console.log('='.repeat(70));
for (const edge of edgeTests) {
  const match = matchIntent(edge.text, graph, createInitialOutlookState());
  const hit = match.node.candidateIntent === edge.shouldNot;
  console.log(`  ${hit ? '✗ BLOCKED' : '✓ OK'} "${edge.text}" → ${match.node.candidateIntent} (${edge.desc})`);
}

// Full happy path simulation using natural speech
console.log('\n' + '='.repeat(70));
console.log('FULL HAPPY PATH (natural speech)');
console.log('='.repeat(70));

const happyPath = [
  'Hi my name is John, who am I speaking with?',
  'Can you tell me what is happening with your Outlook?',
  'Do you see any error message?',
  'Is it in your outbox?',
  'Is your internet working?',
  'Can you get into webmail?',
  'Go to Send and Receive for me',
  'Is Work Offline highlighted in the bottom?',
  'Click it to turn off Work Offline',
  'Try sending a test email now',
  'Has that fixed the issue?',
];

let hpState = createInitialOutlookState();
console.log('  #  Intent                          Confidence  Pressure  Node');
for (let i = 0; i < happyPath.length; i++) {
  const result = runScenarioTurn({ candidateText: happyPath[i], state: hpState, now: () => 1000 });
  hpState = result.stateAfter;
  const d = result.decision;
  console.log(`  ${String(i + 1).padStart(2)} ${d.primaryIntent.padEnd(30)} ${String(Math.round(d.matchConfidence * 100)).padStart(3)}%  ${String(d.pressureAfter).padStart(3)}     ${d.matchedNodes[0]}`);
}

console.log(`\n  Final: issueResolved=${hpState.issueResolved}, pressure=${hpState.pressure}`);
console.log(`  Status: ${hpState.issueResolved ? '✓ PASS' : '✗ FAIL'}`);

// Summary
console.log('\n' + '='.repeat(70));
let totalPassed = 0;
let totalFailed = 0;
for (const t of tests) {
  totalPassed += t.passed;
  totalFailed += t.failed;
}
const overallRate = Math.round((totalPassed / (totalPassed + totalFailed)) * 100);
console.log(`\nOverall: ${totalPassed}/${totalPassed + totalFailed} = ${overallRate}%`);
console.log(`Failures: ${totalFailed}`);

if (totalFailed > 0) {
  console.log('\nFAILED TESTS:');
  for (const t of tests) {
    for (const r of t.results.filter(r => !r.pass)) {
      console.log(`  "${r.text}" → expected ${r.expected}, got ${r.got}`);
    }
  }
}

const exitCode = overallRate >= 90 && hpState.issueResolved ? 0 : 1;
console.log(`\nExit code: ${exitCode}`);
process.exit(exitCode);
