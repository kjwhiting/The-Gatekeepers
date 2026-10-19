# The Gatekeeper — Vision

> "If you're not qualified to do things without AI, you are not qualified to do them with AI."

## Mission

AI makes it easy to produce work that *looks* competent in domains where the person asking has no real competence. The Gatekeeper is a proof of concept for a different default: AI assistance that scales with **demonstrated human skill**, not with a person's self-claimed expertise.

The goal is not to withhold AI from people. It is to make sure that where the stakes are real, the person using AI can tell good output from bad output, and that someone other than the person themselves has a say in whether they can.

## Core Principle: Human Gatekeeping

Self-assessment is the weakest signal of skill. The people best placed to judge competence are the humans around you: peers who do the work, and friends or parents who see how you actually operate.

So the system's trust model is built on people, not on a quiz or a self-declared label:

- **Claimed tier is a starting point, not a verdict.** A user declares a tier per domain, and the system treats it as provisional.
- **Humans can challenge it.** Any other user can flag a claim they believe is inflated.
- **Humans must confirm it.** Clearing a flag or reaching the top tier requires proof of competency plus a vouch from someone already advanced in that domain.

## Domain Tiers

Skill is tracked per domain (e.g. medicine, law, electrical work, finance), because being a professional in one area says nothing about another.

| Tier | Meaning | AI behavior |
|---|---|---|
| `beginner` | Learning, or unproven in this domain | Risk-scored guardrails |
| `intermediate` | Working knowledge, not yet independently vouched | Risk-scored guardrails |
| `advanced` | Strong, peer-recognized competence; can vouch for others | Lighter guardrails; vouching rights |
| `professional` | Vouched, proven, and unflagged | Zero domain guardrails |

For the POC, the proxy applies guardrails to Beginners and to anyone in a review period. Unflagged Professionals pass through untouched.

## Community Flagging

**Anyone can flag.** Peers, friends, and parents are all valid flaggers, because they are often the first to notice when someone's confidence has outrun their ability, in a way no automated system would.

A flag is a request for re-vetting, not a punishment. It says: "I don't think this person's claimed level in this domain is accurate."

Flags should include a domain and a short reason, so the person under review understands what is being questioned and what they would need to show.

## Review Periods

When a user is flagged in a domain:

1. The profile moves into an **in-review period** for that domain (`in_review_period = 1`).
2. The user is **immediately treated as a Beginner** in that domain, regardless of their claimed tier.
3. The restriction stays until the flag is resolved through vouching.

The review period fails safe. Doubt from another human is enough to apply caution, and removing that caution requires positive evidence. Other domains are unaffected.

## Skill Unlocks

Moving up, or back out of review, requires two things together:

1. **Proof of competency**: evidence the person can do the work without AI (a portfolio, a credential, a demonstrated task).
2. **A vouch from an Advanced or Professional peer** in the same domain.

Neither is sufficient alone. Proof without a vouch is self-reported evidence; a vouch without proof is a favor. Requiring both keeps the gate tied to real, checkable skill and to a human willing to put their reputation behind it.

Reaching **Professional** unlocks the final privilege: AI assistance with no domain guardrails.

## How the Proxy Enforces It

All AI conversations pass through `POST /api/chat`:

- **Unflagged Professionals:** the prompt goes through with no domain guardrails.
- **Beginners and users in review:** the prompt gets a **risk score from 1 to 10**.
  - **Score 7 or higher:** hard stop. The response recommends speaking to a professional.
  - **Score below 7:** the response is allowed, with a beginner-level notice prepended.

## Non-Goals (for the POC)

- Not a real identity or credential verification system.
- Not production-grade authentication, abuse prevention, or moderation of flags.
- Not a replacement for professional advice; it simply routes people toward it when risk is high.

## Open Questions

- How to prevent malicious or retaliatory flagging while keeping flagging open to everyone.
- How to keep vouching from becoming a favor economy.
- What counts as sufficient "proof of competency" in each domain.

These are deliberately left open for after the POC proves the core loop.
