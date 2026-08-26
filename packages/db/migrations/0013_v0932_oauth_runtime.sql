PRAGMA foreign_keys = ON;

-- V0.9.3.2 keeps the adapter's authentication and callback contract explicit.
ALTER TABLE platforms ADD COLUMN auth_strategy TEXT NOT NULL DEFAULT 'Unsupported';
ALTER TABLE platforms ADD COLUMN callback_strategy TEXT NOT NULL DEFAULT 'ManualCodeCallback';
ALTER TABLE account_authorizations ADD COLUMN provider_account_id TEXT;
ALTER TABLE account_authorizations ADD COLUMN provider_account_name TEXT;
