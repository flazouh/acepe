import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Str from "effect/String"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(Platform)("Cursor ACP transport source", (it) => {
	it.effect("does not import experimental/v2", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			const here = yield* path.fromFileUrl(new URL(import.meta.url))
			const source = yield* fs.readFileString(path.join(path.dirname(here), "Process.ts"))
			Vitest.assert.isTrue(Str.includes("@agentclientprotocol/sdk")(source))
			Vitest.assert.isTrue(Str.includes("ndJsonStream")(source))
			Vitest.assert.isFalse(Str.includes("experimental/v2")(source))
		})
	)
})
