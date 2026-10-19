/**
 * routes/flags.js — Community flagging.
 *
 *   POST /api/flags
 *   Body: { targetUserId, challengerUserId, domain, reason }
 *
 * Any user can flag any other user in a domain. Flagging puts the target
 * into a review period, which forces Beginner guardrails until resolved.
 */

const express = require('express');
const { getUserById, addFlag } = require('../db');

const router = express.Router();

router.post('/flags', (req, res) => {
  const { targetUserId, challengerUserId, domain, reason } = req.body || {};

  if (!targetUserId || !challengerUserId || !domain) {
    return res
      .status(400)
      .json({ error: 'targetUserId, challengerUserId, and domain are required.' });
  }
  if (String(targetUserId) === String(challengerUserId)) {
    return res.status(400).json({ error: 'You cannot flag yourself.' });
  }
  if (!getUserById(targetUserId) || !getUserById(challengerUserId)) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const { flagId, status } = addFlag({ targetUserId, challengerUserId, domain, reason });
  res.status(201).json({ flagId, status });
});

module.exports = router;
