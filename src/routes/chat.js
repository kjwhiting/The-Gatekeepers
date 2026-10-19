/**
 * routes/chat.js — The AI proxy gateway for "The Gatekeepers" POC.
 *
 * Defines POST /chat and GET /fields. Mount under /api:
 *
 *     app.use('/api', require('./routes/chat'));
 *
 * POST /api/chat  body: { userId, prompt }
 *
 * The person never says which field they're asking about. Two steps:
 *   1. A first, small AI call works out the field (see classifier.js) by
 *      scoring the prompt's relevance to each field on our list.
 *   2. We look up the user's level in that field and make the full AI call
 *      under the matching rules.
 *
 * LLM modes (set in .env):
 *   LLM_MODE=mock   (default) canned responses and keyword matching, no key
 *   LLM_MODE=live   calls the Anthropic Messages API; needs ANTHROPIC_API_KEY
 *                   (optional LLM_MODEL to choose the model)
 */

require('dotenv').config();
const express = require('express');
const { getUserById, getUserDomainStatus } = require('../db');
const { FIELD_NAMES, GENERAL, detectField } = require('../classifier');

const router = express.Router();
router.use(express.json()); // harmless if the server also calls express.json()

// ---------------------------------------------------------------------------
// Fixed response text
// ---------------------------------------------------------------------------

const HARD_STOP_TEXT =
  'I recommend speaking to a professional about this until my software is better equipped to handle the question accurately.';

const BEGINNER_NOTICE =
  "I see you're a beginner in this field (or your profile is currently under community review)...";

const unassignedText = (field) =>
  `I can't answer questions about ${field} yet, because no one has recognized a level for you in that field. ` +
  'Working with someone experienced in it is the way to get started.';

const RISK_THRESHOLD = 7; // score >= 7 means hard stop

// ---------------------------------------------------------------------------
// Risk scoring (simple keyword heuristic, 1–10)
// ---------------------------------------------------------------------------

// Topics where a wrong answer can really hurt someone (+4 each).
const HIGH_RISK_TERMS = [
  'dosage', 'overdose', 'diagnose', 'prescription', 'surgery', 'chemotherapy',
  'lawsuit', 'legally binding', 'tax evasion', 'life savings', 'invest my',
  'wiring', 'gas line', 'weapon',
];

// Signs of leaning on the AI instead of understanding (+2 each).
const OVER_RELIANCE_TERMS = [
  'do it all for me', 'write my entire', 'just tell me what to do',
  'without checking', 'trust you completely', 'no need to verify',
  'skip the research', 'what should i do',
];

// Pressure or certainty-seeking language (+1 each).
const CAUTION_TERMS = [
  'urgent', 'guarantee', 'definitely', 'asap', 'submit as my own',
];

function countMatches(text, terms) {
  return terms.filter((term) => text.includes(term)).length;
}

/**
 * Returns an integer from 1 (low risk) to 10 (high risk).
 * Exported so you can test it directly.
 */
function scorePrompt(prompt) {
  const text = String(prompt).toLowerCase();
  const score =
    1 +
    4 * countMatches(text, HIGH_RISK_TERMS) +
    2 * countMatches(text, OVER_RELIANCE_TERMS) +
    1 * countMatches(text, CAUTION_TERMS);
  return Math.min(10, score);
}

// ---------------------------------------------------------------------------
// LLM layer (mock by default)
// ---------------------------------------------------------------------------

const LIVE_REQUESTED = process.env.LLM_MODE === 'live';
const LIVE = LIVE_REQUESTED && Boolean(process.env.ANTHROPIC_API_KEY);
if (LIVE_REQUESTED && !LIVE) {
  console.warn('LLM_MODE=live but ANTHROPIC_API_KEY is missing; falling back to mock mode.');
}

const BEGINNER_SYSTEM_PROMPT =
  'The user is a beginner in this field. Answer in an educational way: explain the basics clearly, ' +
  'encourage them to understand the reasoning, and suggest checking important points with an expert.';

/** One call to the Anthropic Messages API (Node 18+ built-in fetch). */
async function liveComplete({ system, prompt, maxTokens = 1000 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'claude-sonnet-5-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed with status ${res.status}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/** Mock LLM: no network, no key. */
async function mockLLM(prompt, { beginner }) {
  if (beginner) {
    return (
      `[Mock LLM, educational mode] Here's a starting point on "${prompt}". ` +
      'Begin with the core ideas, work through a small example yourself, and then check your ' +
      'understanding with someone experienced in the field.'
    );
  }
  return `[Mock LLM] Here is a direct, unrestricted answer to: "${prompt}"`;
}

/** Step 2: the full AI call. */
function callLLM(prompt, { beginner }) {
  if (LIVE) {
    return liveComplete({ system: beginner ? BEGINNER_SYSTEM_PROMPT : undefined, prompt });
  }
  return mockLLM(prompt, { beginner });
}

// ---------------------------------------------------------------------------
// GET /fields — the list of fields (for the UI's flag and vouch forms)
// ---------------------------------------------------------------------------

router.get('/fields', (req, res) => res.json(FIELD_NAMES));

// ---------------------------------------------------------------------------
// POST /chat
// ---------------------------------------------------------------------------

router.post('/chat', async (req, res) => {
  const { userId, prompt } = req.body || {}; // any `domain` in the body is ignored

  if (!userId || !prompt) {
    return res.status(400).json({ error: 'userId and prompt are required.' });
  }
  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  try {
    // Step 1: the AI works out the field and we compare its relevance scores
    // to our list of fields.
    const detection = await detectField(prompt, LIVE ? liveComplete : null);
    const field = detection.field;

    const meta = {
      userId: user.id,
      field,
      field_relevance: Math.round(detection.relevance * 100) / 100,
      field_source: detection.source, // 'live', 'mock', or 'mock-fallback'
    };

    // No field on the list is relevant: general chat, nothing to gate.
    if (field === GENERAL) {
      const output = await callLLM(prompt, { beginner: false });
      return res.json({
        ...meta, tier: 'n/a', in_review_period: 0, guardrail: 'none', response: output,
      });
    }

    // Look up the user's standing in the detected field.
    const status = getUserDomainStatus(user.id, field);
    const inReview = status.in_review_period === 1;
    const tier = status.effective_tier; // already 'beginner' when in review
    Object.assign(meta, { tier, in_review_period: inReview ? 1 : 0 });

    // Unassigned: no level in this field yet, so the AI stays quiet about it.
    if (tier === 'unassigned') {
      return res.json({ ...meta, guardrail: 'unassigned', response: unassignedText(field) });
    }

    // Step 2, guarded path: Beginners, and anyone in a review period.
    if (tier === 'beginner' || inReview) {
      const riskScore = scorePrompt(prompt);

      if (riskScore >= RISK_THRESHOLD) {
        return res.json({
          ...meta, guardrail: 'hard_stop', risk_score: riskScore, response: HARD_STOP_TEXT,
        });
      }

      const output = await callLLM(prompt, { beginner: true });
      return res.json({
        ...meta,
        guardrail: 'beginner_notice',
        risk_score: riskScore,
        response: `${BEGINNER_NOTICE}\n\n${output}`,
      });
    }

    // Professional with no review: zero domain guardrails.
    // NOTE: Intermediate and Advanced also land here for now. The spec only
    // defines Beginner/review and Professional behavior; add middle-tier
    // rules here if you want them.
    const output = await callLLM(prompt, { beginner: false });
    return res.json({ ...meta, guardrail: 'none', response: output });
  } catch (err) {
    console.error('Chat proxy error:', err.message);
    return res.status(502).json({ error: 'The AI backend failed to respond.' });
  }
});

module.exports = router;
module.exports.scorePrompt = scorePrompt; // exposed for quick testing
