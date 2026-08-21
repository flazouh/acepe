import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import init from "./Migrations/0001_init.ts"
import eventStore from "./Migrations/0002_event_store.ts"
import projectionState from "./Migrations/0003_projection_state.ts"
import commandReceipts from "./Migrations/0004_command_receipts.ts"
import projectionMessages from "./Migrations/0005_projection_messages.ts"
import projectionSessions from "./Migrations/0006_projection_sessions.ts"
import projectionTurns from "./Migrations/0007_projection_turns.ts"
import projectionProjects from "./Migrations/0011_projection_projects.ts"

const MIGRATIONS_TABLE = "_migrations"

const loader = SqliteMigrator.fromRecord({
	"0001_init": init,
	"0002_event_store": eventStore,
	"0003_projection_state": projectionState,
	"0004_command_receipts": commandReceipts,
	"0005_projection_messages": projectionMessages,
	"0006_projection_sessions": projectionSessions,
	"0007_projection_turns": projectionTurns,
	"0011_projection_projects": projectionProjects
})

export const runMigrations = SqliteMigrator.run({
	loader,
	table: MIGRATIONS_TABLE
})
