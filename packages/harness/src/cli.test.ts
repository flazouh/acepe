import * as Vitest from "@effect/vitest"
import { parseRecordArgs, parseReplayArgs, runHarness, runRecordHarness, runReplayHarness } from "./cli.ts"
import { parseRecordArgs as parseRecordArgsFromRecord, runRecordHarness as runRecordHarnessFromRecord } from "./record.ts"
import { parseReplayArgs as parseReplayArgsFromReplay, runReplayHarness as runReplayHarnessFromReplay } from "./replay.ts"

Vitest.describe("cli", () => {
	Vitest.it("re-exports record and replay harness entries", () => {
		Vitest.assert.strictEqual(parseRecordArgs, parseRecordArgsFromRecord)
		Vitest.assert.strictEqual(runRecordHarness, runRecordHarnessFromRecord)
		Vitest.assert.strictEqual(parseReplayArgs, parseReplayArgsFromReplay)
		Vitest.assert.strictEqual(runReplayHarness, runReplayHarnessFromReplay)
		Vitest.assert.strictEqual(typeof runHarness, "function")
	})
})
