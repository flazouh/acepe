import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Vitest from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { makeSqliteLayer } from "../Layers/Sqlite.ts";
import projectionProjects from "./0011_projection_projects.ts";
import projectionProjectsIcon from "./0035_projection_projects_icon.ts";

const TempSqlite = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = yield* fs.makeTempDirectoryScoped();
		return makeSqliteLayer({
			filename: path.join(dir, "acepe-test.db"),
			readonly: false,
		});
	}),
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const isolatedSqlite = () => Layer.fresh(TempSqlite);

Vitest.layer(isolatedSqlite())(
	"0035_projection_projects_icon columns",
	(it) => {
		it.effect("adds a nullable icon_kind and icon_path pair", () =>
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* projectionProjects;
				yield* projectionProjectsIcon;
				const columns = yield* sql<{
					name: string;
					notnull: number;
					dflt_value: string | null;
				}>`
				PRAGMA table_info(projection_projects)
			`.withoutTransform;

				for (const name of ["icon_kind", "icon_path"]) {
					const column = columns.find((candidate) => candidate.name === name);
					Vitest.assert.isDefined(column, `${name} must exist`);
					// Nullable and default-free on purpose: both columns null is the
					// "auto" choice, which is what every pre-0035 row already holds.
					// A default would write a choice nobody made.
					Vitest.assert.strictEqual(Number(column.notnull), 0);
					Vitest.assert.strictEqual(column.dflt_value, null);
				}
			}),
		);
	},
);

Vitest.layer(isolatedSqlite())(
	"0035_projection_projects_icon backfill",
	(it) => {
		it.effect("leaves a row written before the migration reading as auto", () =>
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* projectionProjects;
				yield* sql`
				INSERT INTO projection_projects (
					project_id, title, workspace_root, created_at, updated_at,
					deleted_at, session_count, scan_warmed_at
				) VALUES (
					'project-old', 'Legacy', '/repo/legacy', '2026-08-01T00:00:00.000Z',
					'2026-08-01T00:00:00.000Z', NULL, 0, '2026-08-01T00:00:00.000Z'
				)
			`.withoutTransform;

				yield* projectionProjectsIcon;

				const rows = yield* sql<{
					icon_kind: string | null;
					icon_path: string | null;
				}>`
				SELECT icon_kind, icon_path FROM projection_projects WHERE project_id = 'project-old'
			`.withoutTransform;
				Vitest.assert.strictEqual(rows.length, 1);
				Vitest.assert.strictEqual(rows[0]?.icon_kind, null);
				Vitest.assert.strictEqual(rows[0]?.icon_path, null);
			}),
		);
	},
);
