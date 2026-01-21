-- Create collaborators table
CREATE TABLE "BoardCollaborator" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardCollaborator_pkey" PRIMARY KEY ("id")
);

-- Create share links table
CREATE TABLE "BoardShare" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "boardId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoardCollaborator_boardId_userId_key" ON "BoardCollaborator"("boardId", "userId");
CREATE INDEX "BoardCollaborator_boardId_idx" ON "BoardCollaborator"("boardId");
CREATE INDEX "BoardCollaborator_userId_idx" ON "BoardCollaborator"("userId");

CREATE UNIQUE INDEX "BoardShare_token_key" ON "BoardShare"("token");
CREATE INDEX "BoardShare_boardId_idx" ON "BoardShare"("boardId");

ALTER TABLE "BoardCollaborator" ADD CONSTRAINT "BoardCollaborator_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardCollaborator" ADD CONSTRAINT "BoardCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BoardShare" ADD CONSTRAINT "BoardShare_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
