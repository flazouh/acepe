import * as Vitest from "@effect/vitest"
import {
	computeAmplitudeBatch,
	encodeWavI16Mono,
	maxAbsSample,
	normalizeAudioForTranscription,
	parseExternalCommandStdout,
	previewText,
	resample,
	titleCaseLanguageName,
	zeroize
} from "./audio.ts"

Vitest.describe("titleCaseLanguageName", () => {
	Vitest.it("uppercases the first letter of english", () => {
		Vitest.assert.strictEqual(titleCaseLanguageName("english"), "English")
	})
})

Vitest.describe("previewText", () => {
	Vitest.it("collapses whitespace and leaves short text", () => {
		Vitest.assert.strictEqual(previewText("  hello   world  "), "hello world")
	})

	Vitest.it("truncates long text at 120 characters", () => {
		const long = "abcdefghij".repeat(13)
		const preview = previewText(long)
		Vitest.assert.strictEqual(preview.endsWith("..."), true)
		Vitest.assert.strictEqual(preview.length, 123)
	})
})

Vitest.describe("computeAmplitudeBatch", () => {
	Vitest.it("boosts quiet capture for the live meter", () => {
		const samples = ArrFilled(96, 0.004)
		const values = computeAmplitudeBatch(samples)
		Vitest.assert.isTrue(values[0] > 0.02)
		Vitest.assert.isTrue(values[1] > 0.02)
		Vitest.assert.isTrue(values[2] > 0.02)
		Vitest.assert.isTrue(values[0] <= 1)
		Vitest.assert.isTrue(values[1] <= 1)
		Vitest.assert.isTrue(values[2] <= 1)
	})

	Vitest.it("keeps silence silent", () => {
		Vitest.assert.deepStrictEqual(computeAmplitudeBatch(ArrFilled(96, 0)), [0, 0, 0])
	})
})

Vitest.describe("normalizeAudioForTranscription", () => {
	Vitest.it("normalizes quiet audio up to the target peak", () => {
		const normalized = normalizeAudioForTranscription([0.05, -0.025, 0, 0.025])
		const peak = maxAbsSample(normalized)
		Vitest.assert.isTrue(peak > 0.8)
		Vitest.assert.isTrue(peak <= 0.851)
	})

	Vitest.it("normalizes very quiet audio up to the target peak", () => {
		const normalized = normalizeAudioForTranscription([0.0138, -0.0069, 0, 0.0069])
		const peak = maxAbsSample(normalized)
		Vitest.assert.isTrue(peak > 0.8)
		Vitest.assert.isTrue(peak <= 0.851)
	})

	Vitest.it("leaves loud audio unchanged", () => {
		const audio = [0.9, -0.4, 0.1]
		Vitest.assert.deepStrictEqual(normalizeAudioForTranscription(audio), audio)
	})
})

Vitest.describe("resample", () => {
	Vitest.it("is a no-op when rates match", () => {
		const input = [1, 2, 3]
		Vitest.assert.deepStrictEqual(resample(input, 16_000, 16_000), input)
	})

	Vitest.it("returns empty for empty input", () => {
		Vitest.assert.deepStrictEqual(resample([], 48_000, 16_000), [])
	})

	Vitest.it("downsamples 48 kHz to about 16 kHz", () => {
		const input = ArrFilled(48_000, 0).map((_, index) => Math.sin(index * 0.001))
		const output = resample(input, 48_000, 16_000)
		const difference = output.length < 16_000 ? 16_000 - output.length : output.length - 16_000
		Vitest.assert.isTrue(difference <= 2)
	})
})

Vitest.describe("parseExternalCommandStdout", () => {
	Vitest.it("parses json stdout", () => {
		const result = parseExternalCommandStdout(
			'{"text":"hello from external","language":"en"}\n'
		)
		Vitest.assert.strictEqual(result.text, "hello from external")
		Vitest.assert.strictEqual(result.language, "en")
	})

	Vitest.it("treats plain text stdout as the transcript", () => {
		const result = parseExternalCommandStdout(" hello plain text \n")
		Vitest.assert.strictEqual(result.text, "hello plain text")
		Vitest.assert.strictEqual(result.language, null)
	})

	Vitest.it("returns empty text for blank stdout", () => {
		const result = parseExternalCommandStdout("   \n")
		Vitest.assert.strictEqual(result.text, "")
		Vitest.assert.strictEqual(result.durationMs, 0)
	})
})

Vitest.describe("encodeWavI16Mono", () => {
	Vitest.it("writes a pcm riff header and one sample per input", () => {
		const bytes = encodeWavI16Mono([0, 0.5, -0.5], 16_000)
		const view = new DataView(bytes.buffer)
		Vitest.assert.strictEqual(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0), "RIFF")
		Vitest.assert.strictEqual(view.getUint32(24, true), 16_000)
		Vitest.assert.strictEqual(view.getUint32(40, true), 6)
		Vitest.assert.strictEqual(bytes.length, 50)
	})
})

Vitest.describe("zeroize", () => {
	Vitest.it("clears accumulated samples", () => {
		const samples = [0.1, -0.2, 0.3]
		zeroize(samples)
		Vitest.assert.strictEqual(samples.length, 0)
	})
})

const ArrFilled = (length: number, value: number): Array<number> => {
	const output: Array<number> = []
	for (let index = 0; index < length; index = index + 1) {
		output.push(value)
	}
	return output
}
