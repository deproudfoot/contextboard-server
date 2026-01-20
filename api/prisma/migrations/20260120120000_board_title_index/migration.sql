-- Rename column from name to title
ALTER TABLE "Board" RENAME COLUMN "name" TO "title";

-- Create index for owner lookup
CREATE INDEX "Board_ownerId_idx" ON "Board"("ownerId");
