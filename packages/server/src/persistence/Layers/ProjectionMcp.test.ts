import {
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import { ProjectionMcp } from "../Services/ProjectionMcp.ts"
import { ProjectionMcpLive } from "./ProjectionMcp.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const catalogEvent = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "mcp",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "McpCatalogResolved",
	payload: {
		projectId,
		catalog: {
			source: "preconnectionConfig",
			servers: [
				{
					id: "github",
					name: "github",
					status: "unknown",
					error: null,
					tools: [],
					slashCommands: []
				}
			]
		}
	}
})

const TempSqlite = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return makeSqliteLayer({
			filename: path.join(dir, "acepe-test.db"),
			readonly: false
		})
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const McpLive = ProjectionMcpLive.pipe(Layer.provideMerge(MigratedSqlite))

Vitest.layer(Layer.fresh(McpLive))("ProjectionMcpLive", (it) => {
	it.effect("upserts an mcp catalog row from McpCatalogResolved", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionMcp
			yield* sql.withTransaction(projection.apply(catalogEvent(1), sql))
			const loaded = yield* projection.get(projectId)
			Vitest.assert.strictEqual(Option.isSome(loaded), true)
			if (Option.isSome(loaded)) {
				Vitest.assert.strictEqual(loaded.value.mcpCatalog.projectId, projectId)
				Vitest.assert.strictEqual(loaded.value.mcpCatalog.catalog.servers[0]?.id, "github")
			}
		})
	)
})

Vitest.describe("ProjectionMcpLive name", () => {
	Vitest.it.effect("decodes the projector name", () =>
		Effect.gen(function*() {
			const name = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)("projection.mcp")
			Vitest.assert.strictEqual(name, "projection.mcp")
		})
	)
})
