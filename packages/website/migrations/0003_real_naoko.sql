DROP INDEX IF EXISTS "report_category_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "report_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "report_created_at_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_category_deleted_idx" ON "reports" USING btree ("category","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_status_deleted_idx" ON "reports" USING btree ("status","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_created_at_deleted_idx" ON "reports" USING btree ("created_at","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_category_status_deleted_idx" ON "reports" USING btree ("category","status","deleted_at");