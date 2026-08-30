import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { defaultProjectColor } from "@acepe/contracts"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import { decodeStoredProjectedProject } from "../Services/ProjectionProjects.ts"
import projectionProjects from "./0011_projection_projects.ts"
import projectionProjectsColor from "./0021_projection_projects_color.ts"
import projectionProjectsSortOrder from "./0033_projection_projects_sort_order.ts"

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

const isolatedSqlite = () => Layer.fresh(TempSqlite)

const NOW = "2026-08-20T12:00:00.000Z"

Vitest.layer(isolatedSqlite())("0021_projection_projects_color", (it) => {
	// The column is nullable so the migration can run without inventing a color
	// for rows written before it. Those rows must still read back with one.
	it.effect("reads a row written before the migration at its default color", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			yield* sql`
				INSERT INTO projection_projects (
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					deleted_at,
					session_count,
					scan_warmed_at
				) VALUES (
					${"project-1"},
					${"Acepe"},
					${"/tmp/acepe"},
					${NOW},
					${NOW},
					${null},
					${0},
					${NOW}
				)
			`.withoutTransform
			yield* projectionProjectsColor
			// The shared row decoder requires sort_order, so that a SELECT which
			// forgets the column fails loudly instead of reading as "never
			// ranked". This test still proves the pre-0021 colour default; it just
			// has to reach the schema this decoder speaks.
			yield* projectionProjectsSortOrder
			const rows = yield* sql`
				SELECT
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					deleted_at,
					session_count,
					color,
					sort_order,
					scan_warmed_at
				FROM projection_projects
			`.withoutTransform
			const project = yield* decodeStoredProjectedProject(rows[0])
			Vitest.assert.strictEqual(project.color, defaultProjectColor("/tmp/acepe"))
		})
	)
})
