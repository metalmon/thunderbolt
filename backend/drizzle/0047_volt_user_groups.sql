-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at http://mozilla.org/MPL/2.0/.

-- Fork: `IF NOT EXISTS` because this migration has been renumbered once already
-- (0040 → 0047, past upstream's 0040–0046). Drizzle's journal is append-only, so a
-- renumbered tag arrives as new work on a stand that already has the column, and a
-- bare ADD COLUMN would fail the migration and leave the backend restarting. See
-- "migration-renumber-bricks-shipped-stands".
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "groups" text[] DEFAULT '{}' NOT NULL;
