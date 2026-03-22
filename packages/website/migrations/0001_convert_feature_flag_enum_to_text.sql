-- Convert feature_flags.name from enum to text
-- This allows adding new feature flags without database migrations

-- Only run if the column is still an enum type
DO $$
BEGIN
    -- Check if the column is an enum type (not text)
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'feature_flags'
        AND column_name = 'name'
        AND udt_name = 'feature_flag'
    ) THEN
        -- Step 1: Create a new text column
        ALTER TABLE "feature_flags" ADD COLUMN "name_text" text;

        -- Step 2: Copy data from enum column to text column
        UPDATE "feature_flags" SET "name_text" = "name"::text;

        -- Step 3: Drop the old enum column (this also drops the PK)
        ALTER TABLE "feature_flags" DROP COLUMN "name";

        -- Step 4: Rename the new column
        ALTER TABLE "feature_flags" RENAME COLUMN "name_text" TO "name";

        -- Step 5: Add NOT NULL constraint
        ALTER TABLE "feature_flags" ALTER COLUMN "name" SET NOT NULL;

        -- Step 6: Add primary key constraint
        ALTER TABLE "feature_flags" ADD PRIMARY KEY ("name");

        RAISE NOTICE 'Converted feature_flags.name from enum to text';
    ELSE
        RAISE NOTICE 'feature_flags.name is already text type, skipping conversion';
    END IF;
END $$;

-- Step 7: Drop the enum type (cleanup) - safe to run multiple times
DROP TYPE IF EXISTS "feature_flag";
