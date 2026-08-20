import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import init from "./Migrations/0001_init.ts"
import eventStore from "./Migrations/0002_event_store.ts"

const MIGRATIONS_TABLE = "_migrations"

const loader = SqliteMigrator.fromRecord({
	"0001_init": init,
	"0002_event_store": eventStore
})

export const runMigrations = SqliteMigrator.run({
	loader,
	table: MIGRATIONS_TABLE
})
