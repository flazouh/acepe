import { ProjectId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { HistoryImportInput, noSessionIdFromLine } from "./importer.ts"

Vitest.describe("HistoryImportInput", () => {
	Vitest.it.effect("decodes a history directory import request", () =>
		Effect.gen(function*() {
			const input = yield* Schema.decodeUnknownEffect(HistoryImportInput)({
				root: "/tmp/claude-history",
				projectId: "project-1",
				workspaceRoot: "/tmp/acepe"
			})
			Vitest.assert.strictEqual(input.root, "/tmp/claude-history")
			Vitest.assert.strictEqual(input.projectId, ProjectId.make("project-1"))
			Vitest.assert.strictEqual(input.workspaceRoot, "/tmp/acepe")
		})
	)
})

Vitest.describe("noSessionIdFromLine", () => {
	Vitest.it("returns none so the file stem becomes the session id", () => {
		Vitest.assert.isTrue(Option.isNone(noSessionIdFromLine({ role: "user" })))
	})
})
