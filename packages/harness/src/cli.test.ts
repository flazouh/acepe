import * as Vitest from "@effect/vitest"
import { parseRecordArgs, runRecordHarness } from "./cli.ts"
import { parseRecordArgs as parseRecordArgsFromRecord, runRecordHarness as runRecordHarnessFromRecord } from "./record.ts"

Vitest.describe("cli", () => {
	Vitest.it("re-exports the record harness entry", () => {
		Vitest.assert.strictEqual(parseRecordArgs, parseRecordArgsFromRecord)
		Vitest.assert.strictEqual(runRecordHarness, runRecordHarnessFromRecord)
	})
})
