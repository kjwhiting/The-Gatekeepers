/**
 * demo.js — End-to-end walkthrough of the community gatekeeping workflow.
 *
 * Start the server first (node server.js), then run: node demo.js
 * Uses Node 18+'s built-in fetch. Exits with code 1 if any check fails.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DOMAIN = 'writing';
const PROMPT = 'Help me outline a short story about a lighthouse keeper.';
const BEGINNER_NOTICE_START = "I see you're a beginner in this field";

let failures = 0;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) failures += 1;
}

function show(label, text) {
  const short = text.length > 110 ? `${text.slice(0, 110)}...` : text;
  console.log(`  ${label}: ${short.replace(/\n/g, ' ')}`);
}

async function main() {
  // Look up seeded users by name, so we don't depend on id order.
  let users;
  try {
    users = (await api('GET', '/api/users')).data;
  } catch (err) {
    console.error(`Could not reach ${BASE}. Is the server running? (node server.js)`);
    process.exit(1);
  }
  const id = Object.fromEntries(users.map((u) => [u.username, u.id]));

  console.log('\nStep 1: Alice (Professional) sends a writing prompt');
  let r = await api('POST', '/api/chat', { userId: id.alice, prompt: PROMPT });
  show('response', r.data.response);
  check('The AI detected the field on its own: writing', r.data.field === 'writing');
  check('Alice gets unrestricted output (no guardrail)', r.data.guardrail === 'none');

  console.log('\nStep 2: Bob flags Alice for concerning AI usage');
  r = await api('POST', '/api/flags', {
    targetUserId: id.alice,
    challengerUserId: id.bob,
    domain: DOMAIN,
    reason: 'Seems to be relying on AI for everything lately.',
  });
  check('Flag created (HTTP 201)', r.status === 201);
  check('Alice is now in a review period', r.data.status && r.data.status.in_review_period === 1);

  console.log('\nStep 3: Alice sends the same prompt');
  r = await api('POST', '/api/chat', { userId: id.alice, prompt: PROMPT });
  show('response', r.data.response);
  check('Alice is treated as a Beginner', r.data.tier === 'beginner');
  check('Beginner notice is prepended', r.data.response.startsWith(BEGINNER_NOTICE_START));

  console.log('\nStep 4: Charlie (Advanced peer) vouches for Alice');
  r = await api('POST', '/api/vouch', {
    vouchedUserId: id.alice,
    voucherUserId: id.charlie,
    domain: DOMAIN,
    proofLink: 'https://example.com/alice-writing-portfolio',
  });
  check('Vouch accepted (HTTP 201)', r.status === 201);
  check('Review period cleared', r.data.status && r.data.status.in_review_period === 0);

  console.log('\nStep 5: Alice sends the prompt again');
  r = await api('POST', '/api/chat', { userId: id.alice, prompt: PROMPT });
  show('response', r.data.response);
  check('Professional access restored (no guardrail)', r.data.guardrail === 'none');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
