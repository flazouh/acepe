import * as Vitest from "@effect/vitest"
import { VoiceService } from "./VoiceService.ts"

Vitest.describe("VoiceService", () => {
	Vitest.it("is keyed as the voice service", () => {
		Vitest.assert.strictEqual(VoiceService.key, "@acepe/server/voice/Services/VoiceService")
	})
})
