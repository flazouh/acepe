import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import init from "./Migrations/0001_init.ts"
import eventStore from "./Migrations/0002_event_store.ts"
import commandReceipts from "./Migrations/0004_command_receipts.ts"

const MIGRATIONS_TABLE = "_migrations"

const loader = SqliteMigrator.fromRecord({
	"0001_init": init,
	"0002_event_store": eventStore,
	"0004_command_receipts": commandReceipts
})

export const runMigrations = SqliteMigrator.run({
	loader,
	table: MIGRATIONS_TABLE
})
