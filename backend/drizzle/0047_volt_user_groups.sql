-- Fork: `IF NOT EXISTS` because this migration has been renumbered once already
-- (0040 → 0047, past upstream's 0040–0046). Drizzle's journal is append-only, so a
-- renumbered tag arrives as new work on a stand that already has the column, and a
-- bare ADD COLUMN would fail the migration and leave the backend restarting. See
-- "migration-renumber-bricks-shipped-stands".
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "groups" text[] DEFAULT '{}' NOT NULL;
