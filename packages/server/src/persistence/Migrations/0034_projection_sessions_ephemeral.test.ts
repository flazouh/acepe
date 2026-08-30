import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Vitest from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { makeSqliteLayer } from "../Layers/Sqlite.ts";
import projectionSessions from "./0006_projection_sessions.ts";
import projectionSessionsEphemeral from "./0034_projection_sessions_ephemeral.ts";

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
	"0034_projection_sessions_ephemeral columns",
	(it) => {
		it.effect("adds an ephemeral flag that defaults to 0", () =>
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* projectionSessions;
				yield* projectionSessionsEphemeral;
				const columns = yield* sql<{
					name: string;
					notnull: number;
					dflt_value: string | null;
				}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform;
				const column = columns.find(
					(candidate) => candidate.name === "ephemeral",
				);
				Vitest.assert.isDefined(column, "ephemeral must exist");
				Vitest.assert.strictEqual(Number(column.notnull), 1);
				Vitest.assert.strictEqual(column.dflt_value, "0");
			}),
		);
	},
);
