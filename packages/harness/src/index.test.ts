import * as Vitest from "@effect/vitest"
import { parseRecordArgs, parseReplayArgs, redactSecrets, runRecordHarness, SECRET_FIELD_ALLOWLIST } from "./index.ts"
import { parseRecordArgs as parseRecordArgsFromRecord, runRecordHarness as runRecordHarnessFromRecord } from "./record.ts"
import { parseReplayArgs as parseReplayArgsFromReplay } from "./replay.ts"
import { REDACTED_SECRET } from "./redact.ts"

Vitest.describe("index", () => {
	Vitest.it("re-exports recording and replay helpers", () => {
		Vitest.assert.strictEqual(parseRecordArgs, parseRecordArgsFromRecord)
		Vitest.assert.strictEqual(runRecordHarness, runRecordHarnessFromRecord)
		Vitest.assert.strictEqual(parseReplayArgs, parseReplayArgsFromReplay)
		Vitest.assert.isTrue(SECRET_FIELD_ALLOWLIST.includes("apiKey"))
		Vitest.assert.deepStrictEqual(redactSecrets({ apiKey: "sk-live-secret" }), {
			apiKey: REDACTED_SECRET,
		})
	})
})
