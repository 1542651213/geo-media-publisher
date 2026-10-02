-- Preserve F's bindings and every historical account/job/intent/record.
-- Unassigned accounts have no row and are represented by version 0 in Main.
ALTER TABLE operations_account_company_bindings
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
