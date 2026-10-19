/**
 * db.js — Database layer for "The Gatekeepers" POC.
 *
 * - Opens (or creates) a single local SQLite file: gatekeeper.db
 * - Creates the schema if it doesn't exist
 * - Seeds mock users on first run (only when the users table is empty)
 * - Exposes small helper functions for the Express routes (Sprint 3+)
 *
 * Uses better-sqlite3, which is synchronous: no callbacks or promises.
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// DB location: DB_PATH from .env if set, otherwise gatekeeper.db in the
// directory you launch the app from.
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'gatekeeper.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON'); // enforce the user_id references below

// Tiers that can be stored. "unassigned" is intentionally NOT stored: a user
// with no domain_profiles row for a domain is unassigned in that domain
// (see getUserDomainStatus).
const TIERS = ['beginner', 'intermediate', 'advanced', 'professional'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
  -- People. role is free text, e.g. 'adult', 'parent', 'teen'.
  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    role     TEXT NOT NULL DEFAULT 'adult'
  );

  -- One row per (user, domain). claimed_tier is the level on record;
  -- effective_tier is what the proxy actually enforces (equals claimed_tier
  -- unless the user is in a review period, then it is 'beginner').
  -- in_review_period is 0/1 (SQLite has no boolean type).
  CREATE TABLE IF NOT EXISTS domain_profiles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    domain           TEXT NOT NULL,
    claimed_tier     TEXT NOT NULL
      CHECK (claimed_tier IN ('beginner','intermediate','advanced','professional')),
    effective_tier   TEXT NOT NULL
      CHECK (effective_tier IN ('beginner','intermediate','advanced','professional')),
    in_review_period INTEGER NOT NULL DEFAULT 0 CHECK (in_review_period IN (0,1)),
    UNIQUE (user_id, domain)
  );

  -- Anyone can flag anyone in a domain. status: 'open' or 'resolved'.
  CREATE TABLE IF NOT EXISTS flags (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id     INTEGER NOT NULL REFERENCES users(id),
    challenger_user_id INTEGER NOT NULL REFERENCES users(id),
    domain             TEXT NOT NULL,
    reason             TEXT,
    status             TEXT NOT NULL DEFAULT 'open'
  );

  -- A vouch from someone established in a domain, with a link to proof.
  CREATE TABLE IF NOT EXISTS vouches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    vouched_user_id INTEGER NOT NULL REFERENCES users(id),
    voucher_user_id INTEGER NOT NULL REFERENCES users(id),
    domain          TEXT NOT NULL,
    proof_link      TEXT
  );
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Effective tier rule: in review means forced to 'beginner'. */
function computeEffectiveTier(claimedTier, inReview) {
  return inReview ? 'beginner' : claimedTier;
}

/** Look up a user by id. Returns the row or undefined. */
function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/** Look up a user by username. Returns the row or undefined. */
function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

/**
 * Get a user's status in a domain. This is what the chat proxy will use.
 * If the user has no profile for the domain, they are 'unassigned' there
 * (the proxy should decline to answer questions in that domain).
 */
function getUserDomainStatus(userId, domain) {
  const row = db
    .prepare('SELECT * FROM domain_profiles WHERE user_id = ? AND domain = ?')
    .get(userId, domain);

  if (row) return row;

  return {
    user_id: userId,
    domain,
    claimed_tier: 'unassigned',
    effective_tier: 'unassigned',
    in_review_period: 0,
  };
}

/** All open flags against a user in a domain. */
function getOpenFlags(targetUserId, domain) {
  return db
    .prepare(
      `SELECT * FROM flags
       WHERE target_user_id = ? AND domain = ? AND status = 'open'`
    )
    .all(targetUserId, domain);
}

/** All vouches a user has received in a domain. */
function getVouches(vouchedUserId, domain) {
  return db
    .prepare('SELECT * FROM vouches WHERE vouched_user_id = ? AND domain = ?')
    .all(vouchedUserId, domain);
}

/**
 * Turn the review period on or off for a user in a domain, keeping
 * effective_tier in sync. Returns the updated status, or null if the user
 * has no profile in that domain (unassigned users have nothing to review).
 */
function setReviewState(userId, domain, inReview) {
  const profile = db
    .prepare('SELECT claimed_tier FROM domain_profiles WHERE user_id = ? AND domain = ?')
    .get(userId, domain);
  if (!profile) return null;

  db.prepare(
    `UPDATE domain_profiles
     SET in_review_period = ?, effective_tier = ?
     WHERE user_id = ? AND domain = ?`
  ).run(inReview ? 1 : 0, computeEffectiveTier(profile.claimed_tier, inReview), userId, domain);

  return getUserDomainStatus(userId, domain);
}

/**
 * Add a flag and immediately put the target into a review period.
 * Both steps happen in one transaction. Returns { flagId, status }.
 */
const addFlag = db.transaction(({ targetUserId, challengerUserId, domain, reason }) => {
  const info = db
    .prepare(
      `INSERT INTO flags (target_user_id, challenger_user_id, domain, reason)
       VALUES (?, ?, ?, ?)`
    )
    .run(targetUserId, challengerUserId, domain, reason || null);

  const status = setReviewState(targetUserId, domain, true);
  return { flagId: info.lastInsertRowid, status };
});

/** True if the user is currently Advanced or Professional in the domain. */
function isEligibleVoucher(userId, domain) {
  const { effective_tier } = getUserDomainStatus(userId, domain);
  return effective_tier === 'advanced' || effective_tier === 'professional';
}

/**
 * Record a vouch. Only an Advanced/Professional peer can vouch (a voucher
 * who is themselves under review counts as Beginner, so they can't).
 * This only records the vouch; resolving flags is a separate step
 * (see resolveFlags). Returns the new vouch id.
 */
function addVouch({ vouchedUserId, voucherUserId, domain, proofLink }) {
  if (!isEligibleVoucher(voucherUserId, domain)) {
    throw new Error('Voucher must be Advanced or Professional in this domain.');
  }
  const info = db
    .prepare(
      `INSERT INTO vouches (vouched_user_id, voucher_user_id, domain, proof_link)
       VALUES (?, ?, ?, ?)`
    )
    .run(vouchedUserId, voucherUserId, domain, proofLink || null);
  return info.lastInsertRowid;
}

/**
 * Close all open flags against a user in a domain and end their review
 * period. Call this once the vouch requirement has been met.
 */
const resolveFlags = db.transaction((targetUserId, domain) => {
  db.prepare(
    `UPDATE flags SET status = 'resolved'
     WHERE target_user_id = ? AND domain = ? AND status = 'open'`
  ).run(targetUserId, domain);

  return setReviewState(targetUserId, domain, false);
});

// ---------------------------------------------------------------------------
// Seed data (runs only when the database is empty)
// ---------------------------------------------------------------------------

function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  const insertUser = db.prepare('INSERT INTO users (username, role) VALUES (?, ?)');
  const insertProfile = db.prepare(
    `INSERT INTO domain_profiles
       (user_id, domain, claimed_tier, effective_tier, in_review_period)
     VALUES (?, ?, ?, ?, 0)`
  );

  db.transaction(() => {
    // Alice: Professional writer, unflagged.
    const alice = insertUser.run('alice', 'adult').lastInsertRowid;
    insertProfile.run(alice, 'writing', 'professional', 'professional');

    // Bob: Beginner writer.
    const bob = insertUser.run('bob', 'adult').lastInsertRowid;
    insertProfile.run(bob, 'writing', 'beginner', 'beginner');

    // Charlie: a parent who is also an Advanced writer, so he can flag people
    // (e.g. Dave) and vouch for peers (e.g. Alice in the demo).
    const charlie = insertUser.run('charlie', 'parent').lastInsertRowid;
    insertProfile.run(charlie, 'writing', 'advanced', 'advanced');

    // Dave: a teenager, Beginner writer.
    const dave = insertUser.run('dave', 'teen').lastInsertRowid;
    insertProfile.run(dave, 'writing', 'beginner', 'beginner');
  })();

  console.log('Seeded gatekeeper.db with alice, bob, charlie, dave.');
}

seed();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  db,
  TIERS,
  computeEffectiveTier,
  getUserById,
  getUserByUsername,
  getUserDomainStatus,
  getOpenFlags,
  getVouches,
  setReviewState,
  addFlag,
  isEligibleVoucher,
  addVouch,
  resolveFlags,
};
