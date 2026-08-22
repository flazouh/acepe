import * as Vitest from "@effect/vitest"
import { TranscriptionEngine } from "./TranscriptionEngine.ts"

Vitest.describe("TranscriptionEngine", () => {
	Vitest.it("is keyed as the transcription engine", () => {
		Vitest.assert.strictEqual(
			TranscriptionEngine.key,
			"@acepe/server/voice/Services/TranscriptionEngine"
		)
	})
})
