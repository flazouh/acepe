import * as Vitest from "@effect/vitest"
import { parseRecordArgs, redactSecrets, runRecordHarness, SECRET_FIELD_ALLOWLIST } from "./index.ts"
import { parseRecordArgs as parseRecordArgsFromRecord, runRecordHarness as runRecordHarnessFromRecord } from "./record.ts"
import { REDACTED_SECRET } from "./redact.ts"

Vitest.describe("index", () => {
	Vitest.it("re-exports recording helpers", () => {
		Vitest.assert.strictEqual(parseRecordArgs, parseRecordArgsFromRecord)
		Vitest.assert.strictEqual(runRecordHarness, runRecordHarnessFromRecord)
		Vitest.assert.isTrue(SECRET_FIELD_ALLOWLIST.includes("apiKey"))
		Vitest.assert.deepStrictEqual(redactSecrets({ apiKey: "sk-live-secret" }), {
			apiKey: REDACTED_SECRET,
		})
	})
})
