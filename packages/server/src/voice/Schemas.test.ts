import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import {
	EXTERNAL_BACKEND_ID,
	EXTERNAL_BACKEND_NAME,
	EXTERNAL_BACKEND_SENTINEL_PATH,
	emptyTranscriptionResult,
	MAX_SECS,
	TranscriptionResult,
	VoiceAmplitudeEvent,
	VoiceLanguageOption,
	VoiceModelInfo,
	WARN_SECS,
	WHISPER_SAMPLE_RATE
} from "./Schemas.ts"

const decodeModel = Schema.decodeUnknownSync(VoiceModelInfo)
const decodeLanguage = Schema.decodeUnknownSync(VoiceLanguageOption)
const decodeResult = Schema.decodeUnknownSync(TranscriptionResult)

Vitest.describe("voice constants", () => {
	Vitest.it("keeps the rust external backend id and sentinel path", () => {
		Vitest.assert.strictEqual(EXTERNAL_BACKEND_ID, "external")
		Vitest.assert.strictEqual(EXTERNAL_BACKEND_NAME, "Speech to text")
		Vitest.assert.strictEqual(EXTERNAL_BACKEND_SENTINEL_PATH, "__acepe_external_stt_backend__")
	})

	Vitest.it("keeps whisper sample rate and duration limits", () => {
		Vitest.assert.strictEqual(WHISPER_SAMPLE_RATE, 16_000)
		Vitest.assert.strictEqual(WARN_SECS, 8 * 60)
		Vitest.assert.strictEqual(MAX_SECS, 10 * 60)
	})
})

Vitest.describe("VoiceModelInfo", () => {
	Vitest.it("decodes the external backend row", () => {
		const info = decodeModel({
			id: EXTERNAL_BACKEND_ID,
			name: EXTERNAL_BACKEND_NAME,
			sizeBytes: 0,
			isEnglishOnly: false,
			isDownloaded: true,
			isLoaded: false,
			downloadUrl: ""
		})
		Vitest.assert.strictEqual(info.id, "external")
		Vitest.assert.strictEqual(info.isDownloaded, true)
		Vitest.assert.strictEqual(info.isLoaded, false)
	})
})

Vitest.describe("VoiceLanguageOption", () => {
	Vitest.it("decodes auto and english rows", () => {
		const auto = decodeLanguage({ code: "auto", name: "Auto" })
		const english = decodeLanguage({ code: "en", name: "English" })
		Vitest.assert.strictEqual(auto.code, "auto")
		Vitest.assert.strictEqual(english.name, "English")
	})
})

Vitest.describe("TranscriptionResult", () => {
	Vitest.it("keeps null language for empty idle-stop results", () => {
		const result = decodeResult(emptyTranscriptionResult)
		Vitest.assert.strictEqual(result.text, "")
		Vitest.assert.strictEqual(result.language, null)
		Vitest.assert.strictEqual(result.durationMs, 0)
	})
})

Vitest.describe("VoiceAmplitudeEvent", () => {
	Vitest.it("carries three meter values", () => {
		const event = new VoiceAmplitudeEvent({
			sessionId: "session-1",
			values: [0.1, 0.2, 0.3]
		})
		Vitest.assert.strictEqual(event._tag, "VoiceAmplitude")
		Vitest.assert.strictEqual(event.values[0], 0.1)
		Vitest.assert.strictEqual(event.values[2], 0.3)
	})
})
