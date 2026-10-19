/**
 * routes/users.js — Read-only user lookups.
 *
 *   GET /api/users      list all users, each with their domain profiles
 *   GET /api/users/:id  one user with their domain profiles
 */

const express = require('express');
const { db, getUserById } = require('../db');

const router = express.Router();

function profilesFor(userId) {
  return db.prepare('SELECT * FROM domain_profiles WHERE user_id = ?').all(userId);
}

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users.map((u) => ({ ...u, profiles: profilesFor(u.id) })));
});

router.get('/users/:id', (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ ...user, profiles: profilesFor(user.id) });
});

module.exports = router;
