import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { SessionId } from "./ids.ts"
import {
	APP_VOICE_ID,
	emptyProjectedVoice,
	emptyVoiceCatalog,
	emptyVoiceTranscriptionResult,
	placeholderVoiceModel,
	ProjectedVoice,
	VoiceCatalog,
	VoiceLanguageOption,
	VoiceModelInfo,
	VoiceTranscriptionResult,
} from "./voice.ts"

const decodeModel = Schema.decodeUnknownEffect(VoiceModelInfo)
const decodeLanguage = Schema.decodeUnknownEffect(VoiceLanguageOption)
const decodeResult = Schema.decodeUnknownEffect(VoiceTranscriptionResult)
const decodeCatalog = Schema.decodeUnknownEffect(VoiceCatalog)
const decodeProjected = Schema.decodeUnknownEffect(ProjectedVoice)

describe("APP_VOICE_ID", () => {
	it("is the singleton voice aggregate id", () => {
		expect(String(APP_VOICE_ID)).toBe("app")
	})
})

describe("VoiceModelInfo", () => {
	it("decodes an external backend row", () => {
		const model = Effect.runSync(
			decodeModel({
				id: "external",
				name: "Speech to text",
				sizeBytes: 0,
				isEnglishOnly: false,
				isDownloaded: false,
				isLoaded: false,
				downloadUrl: "",
			}),
		)
		expect(model.id).toBe("external")
		expect(model.isDownloaded).toBe(false)
	})

	it("rejects an empty model id", () => {
		expect(() =>
			Effect.runSync(
				decodeModel({
					id: "  ",
					name: "Speech to text",
					sizeBytes: 0,
					isEnglishOnly: false,
					isDownloaded: false,
					isLoaded: false,
					downloadUrl: "",
				}),
			),
		).toThrow()
	})
})

describe("VoiceLanguageOption", () => {
	it("decodes an auto language row", () => {
		const language = Effect.runSync(
			decodeLanguage({
				code: "auto",
				name: "Auto",
			}),
		)
		expect(language.code).toBe("auto")
	})
})

describe("VoiceTranscriptionResult", () => {
	it("decodes an empty transcription", () => {
		const result = Effect.runSync(decodeResult(emptyVoiceTranscriptionResult))
		expect(result.text).toBe("")
		expect(result.language).toBe(null)
		expect(result.durationMs).toBe(0)
	})
})

describe("VoiceCatalog", () => {
	it("decodes an empty catalog", () => {
		const catalog = Effect.runSync(decodeCatalog(emptyVoiceCatalog))
		expect(catalog.models).toEqual([])
		expect(catalog.languages).toEqual([])
	})
})

describe("ProjectedVoice", () => {
	it("decodes an empty projected row at sequence 0", () => {
		const projected = Effect.runSync(decodeProjected(emptyProjectedVoice(0)))
		expect(projected.sequence).toBe(0)
		expect(projected.recording).toBe(null)
		expect(projected.lastTranscription).toBe(null)
	})

	it("decodes a recording session and last transcription", () => {
		const sessionId = SessionId.make("session-1")
		const projected = Effect.runSync(
			decodeProjected({
				sequence: 4,
				models: [placeholderVoiceModel("external")],
				languages: [{ code: "en", name: "English" }],
				recording: {
					sessionId,
					phase: "recording",
				},
				lastTranscription: {
					sessionId,
					text: "hello",
					language: "en",
					durationMs: 12,
				},
			}),
		)
		expect(projected.recording?.sessionId).toBe(sessionId)
		expect(projected.lastTranscription?.text).toBe("hello")
	})
})
