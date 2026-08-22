import * as Vitest from "@effect/vitest"
import { MicrophoneCapture, NO_MICROPHONE_MESSAGE } from "./MicrophoneCapture.ts"

Vitest.describe("MicrophoneCapture", () => {
	Vitest.it("is keyed as the microphone capture adapter", () => {
		Vitest.assert.strictEqual(
			MicrophoneCapture.key,
			"@acepe/server/voice/Services/MicrophoneCapture"
		)
	})

	Vitest.it("keeps the rust missing-device copy", () => {
		Vitest.assert.strictEqual(
			NO_MICROPHONE_MESSAGE.includes("No audio input device available"),
			true
		)
	})
})
