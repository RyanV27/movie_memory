-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "movieTitle" VARCHAR(100) NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fact_userId_movieTitle_createdAt_idx" ON "Fact"("userId", "movieTitle", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
