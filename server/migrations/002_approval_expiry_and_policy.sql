-- 002_approval_expiry_and_policy.sql
-- Adds an expiration timestamp to pending approval requests and reconciles
-- the approval-policy vocabulary.

ALTER TABLE approvals ADD COLUMN expires_at TEXT;

-- Backfill existing pending approvals with a 24h expiry from request time.
UPDATE approvals
   SET expires_at = datetime(requested_at, '+24 hours')
 WHERE expires_at IS NULL;

-- Rename the confusing 'always_approve' policy value. The value was always
-- interpreted as "always require approval", and is now spelled explicitly.
UPDATE agents
   SET approval_policy = 'always_require_approval'
 WHERE approval_policy = 'always_approve';