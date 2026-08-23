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
import { ProjectionGit } from "../Services/ProjectionGit.ts"
import { ProjectionGitLive } from "./ProjectionGit.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const statusEvent = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "git",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "GitStatusRefreshed",
	payload: {
		projectId,
		status: [
			{
				path: "notes.md",
				status: "M",
				insertions: 2,
				deletions: 2
			}
		]
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

const GitLive = ProjectionGitLive.pipe(Layer.provideMerge(MigratedSqlite))

Vitest.layer(Layer.fresh(GitLive))("ProjectionGitLive", (it) => {
	it.effect("upserts a git review row from GitStatusRefreshed", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionGit
			yield* sql.withTransaction(projection.apply(statusEvent(1), sql))
			const loaded = yield* projection.get(projectId)
			Vitest.assert.strictEqual(Option.isSome(loaded), true)
			if (Option.isSome(loaded)) {
				Vitest.assert.strictEqual(loaded.value.projectId, projectId)
				Vitest.assert.strictEqual(loaded.value.status?.[0]?.path, "notes.md")
			}
		})
	)
})

Vitest.describe("ProjectionGitLive name", () => {
	Vitest.it.effect("decodes the projector name", () =>
		Effect.gen(function*() {
			const name = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)("projection.git")
			Vitest.assert.strictEqual(name, "projection.git")
		})
	)
})
