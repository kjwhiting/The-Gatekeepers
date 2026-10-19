/**
 * routes/vouch.js — Peer vouching.
 *
 *   POST /api/vouch
 *   Body: { vouchedUserId, voucherUserId, domain, proofLink }
 *
 * Needs proof of competency (proofLink) plus a vouch from an Advanced or
 * Professional peer. If the vouched user is in a review period, a valid
 * vouch resolves their open flags and ends the review.
 */

const express = require('express');
const {
  getUserById,
  getUserDomainStatus,
  addVouch,
  resolveFlags,
} = require('../db');

const router = express.Router();

router.post('/vouch', (req, res) => {
  const { vouchedUserId, voucherUserId, domain, proofLink } = req.body || {};

  if (!vouchedUserId || !voucherUserId || !domain || !proofLink) {
    return res.status(400).json({
      error: 'vouchedUserId, voucherUserId, domain, and proofLink are required.',
    });
  }
  if (String(vouchedUserId) === String(voucherUserId)) {
    return res.status(400).json({ error: 'You cannot vouch for yourself.' });
  }
  if (!getUserById(vouchedUserId) || !getUserById(voucherUserId)) {
    return res.status(404).json({ error: 'User not found.' });
  }

  let vouchId;
  try {
    vouchId = addVouch({ vouchedUserId, voucherUserId, domain, proofLink });
  } catch (err) {
    // addVouch throws when the voucher isn't Advanced/Professional.
    return res.status(403).json({ error: err.message });
  }

  // Vouch recorded: clear the review period if there is one.
  let status = getUserDomainStatus(vouchedUserId, domain);
  if (status.in_review_period === 1) {
    status = resolveFlags(vouchedUserId, domain);
  }

  res.status(201).json({ vouchId, status });
});

module.exports = router;
