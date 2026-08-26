PRAGMA foreign_keys = ON;

-- V0.4 distinguishes "not researched" from "researched but no adapter exists".
-- Existing installations used the legacy Unverified lifecycle value for both.
UPDATE platforms
SET verification_status = 'NotImplemented'
WHERE adapter_status = 'not_implemented'
  AND verification_status IN ('Unverified', 'NotResearched');
