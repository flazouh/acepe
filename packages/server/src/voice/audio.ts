import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import {
	LIVE_METER_TARGET_PEAK,
	MAX_LIVE_METER_GAIN,
	MAX_NORMALIZATION_GAIN,
	TRANSCRIPTION_TARGET_PEAK,
	type AmplitudeValues,
	type TranscriptionResult,
	emptyTranscriptionResult
} from "./Schemas.ts"

const ExternalCommandJsonOutput = Schema.Struct({
	text: Schema.String,
	language: Schema.String.pipe(Schema.NullOr, Schema.optionalKey)
})

const decodeExternalJson = Schema.decodeUnknownOption(Schema.fromJsonString(ExternalCommandJsonOutput))

export const titleCaseLanguageName = (name: string): string => {
	const words = Str.split(name, " ")
	let result = ""
	for (let index = 0; index < words.length; index = index + 1) {
		const word = words[index]
		if (word === undefined || word.length === 0) {
			continue
		}
		if (index > 0) {
			result = `${result} `
		}
		result = `${result}${word.charAt(0).toUpperCase()}${word.slice(1)}`
	}
	return result
}

export const previewText = (text: string): string => {
	const normalized = Str.trim(text).replace(/\s+/g, " ")
	if (normalized.length <= 120) {
		return normalized
	}
	return `${normalized.slice(0, 120)}...`
}

export const maxAbsSample = (samples: ReadonlyArray<number>): number => {
	let max = 0
	for (const sample of samples) {
		const abs = sample < 0 ? -sample : sample
		if (abs > max) {
			max = abs
		}
	}
	return max
}

export const rmsLevel = (samples: ReadonlyArray<number>): number => {
	if (samples.length === 0) {
		return 0
	}
	let sum = 0
	for (const sample of samples) {
		sum = sum + sample * sample
	}
	return Math.sqrt(sum / samples.length)
}

export const clamp = (value: number, min: number, max: number): number => {
	if (value < min) {
		return min
	}
	if (value > max) {
		return max
	}
	return value
}

export const normalizationGainForPeak = (peak: number): number => {
	if (peak <= 0) {
		return 1
	}
	return clamp(TRANSCRIPTION_TARGET_PEAK / peak, 1, MAX_NORMALIZATION_GAIN)
}

export const liveMeterGainForPeak = (peak: number): number => {
	if (peak <= 0) {
		return 1
	}
	return clamp(LIVE_METER_TARGET_PEAK / peak, 1, MAX_LIVE_METER_GAIN)
}

export const normalizeAudioForTranscription = (samples: ReadonlyArray<number>): Array<number> => {
	if (samples.length === 0) {
		return Arr.empty()
	}
	const gain = normalizationGainForPeak(maxAbsSample(samples))
	if (gain <= 1) {
		return Arr.fromIterable(samples)
	}
	const output = Arr.empty<number>()
	for (const sample of samples) {
		output.push(clamp(sample * gain, -1, 1))
	}
	return output
}

export const computeAmplitudeBatch = (samples: ReadonlyArray<number>): AmplitudeValues => {
	if (samples.length === 0) {
		return [0, 0, 0]
	}
	const gain = liveMeterGainForPeak(maxAbsSample(samples))
	const chunk = Math.max(1, Math.trunc(samples.length / 3))
	const rms = (slice: ReadonlyArray<number>): number => {
		if (slice.length === 0) {
			return 0
		}
		return clamp(rmsLevel(slice) * gain, 0, 1)
	}
	const secondStart = chunk
	const thirdStart = Math.min(chunk * 2, samples.length)
	return [
		rms(Arr.take(samples, chunk)),
		rms(samples.slice(secondStart, thirdStart)),
		rms(Arr.drop(samples, thirdStart))
	]
}

export const resample = (
	input: ReadonlyArray<number>,
	inputRate: number,
	targetRate: number
): Array<number> => {
	if (inputRate === targetRate || input.length === 0) {
		return Arr.fromIterable(input)
	}
	const ratio = inputRate / targetRate
	const outputLen = Math.ceil(input.length / ratio)
	const output = Arr.empty<number>()
	for (let index = 0; index < outputLen; index = index + 1) {
		const src = index * ratio
		const floor = Math.trunc(src)
		const frac = src - floor
		const a = input[floor] ?? 0
		const b = input[floor + 1] ?? a
		output.push(a + frac * (b - a))
	}
	return output
}

export const zeroize = (samples: Array<number>): void => {
	for (let index = 0; index < samples.length; index = index + 1) {
		samples[index] = 0
	}
	samples.length = 0
}

const writeAscii = (view: DataView, offset: number, text: string): void => {
	for (let index = 0; index < text.length; index = index + 1) {
		view.setUint8(offset + index, text.charCodeAt(index))
	}
}

const readAscii = (view: DataView, offset: number, length: number): string => {
	let text = ""
	for (let index = 0; index < length; index = index + 1) {
		text = text + String.fromCharCode(view.getUint8(offset + index))
	}
	return text
}

export const encodeWavI16Mono = (audio: ReadonlyArray<number>, sampleRate: number): Uint8Array => {
	const dataLen = audio.length * 2
	const bytes = new Uint8Array(44 + dataLen)
	const view = new DataView(bytes.buffer)
	writeAscii(view, 0, "RIFF")
	view.setUint32(4, 36 + dataLen, true)
	writeAscii(view, 8, "WAVE")
	writeAscii(view, 12, "fmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true)
	view.setUint16(22, 1, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true)
	view.setUint16(32, 2, true)
	view.setUint16(34, 16, true)
	writeAscii(view, 36, "data")
	view.setUint32(40, dataLen, true)
	let offset = 44
	for (const sample of audio) {
		const scaled = Math.trunc(clamp(sample, -1, 1) * 32_767)
		view.setInt16(offset, scaled, true)
		offset = offset + 2
	}
	return bytes
}

/**
 * Reads a 16-bit PCM mono wav back into the sample shape the capture pipeline
 * carries. The counterpart to encodeWavI16Mono, and the reason the QA
 * microphone can play a real recording instead of a tone: a tone proves the
 * dictation pipeline ran, and only speech proves it transcribed.
 *
 * Returns none for anything that is not a RIFF/WAVE file, or that is not the
 * one format this reads.
 */
export const decodeWavI16Mono = (
	bytes: Uint8Array
): Option.Option<{ readonly samples: Array<number>; readonly sampleRate: number }> => {
	if (bytes.length < 44) {
		return Option.none()
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
		return Option.none()
	}
	let cursor = 12
	let sampleRate = 0
	let channels = 0
	let bitsPerSample = 0
	while (cursor + 8 <= bytes.length) {
		const chunkId = readAscii(view, cursor, 4)
		const chunkSize = view.getUint32(cursor + 4, true)
		const body = cursor + 8
		if (chunkId === "fmt ") {
			channels = view.getUint16(body + 2, true)
			sampleRate = view.getUint32(body + 4, true)
			bitsPerSample = view.getUint16(body + 14, true)
		}
		if (chunkId === "data") {
			if (channels !== 1 || bitsPerSample !== 16 || sampleRate === 0) {
				return Option.none()
			}
			const count = Math.min(chunkSize, bytes.length - body) / 2
			const samples = Arr.empty<number>()
			for (let index = 0; index < count; index = index + 1) {
				samples.push(view.getInt16(body + index * 2, true) / 32_768)
			}
			return Option.some({ samples, sampleRate })
		}
		cursor = body + chunkSize + (chunkSize % 2)
	}
	return Option.none()
}

export const parseExternalCommandStdout = (stdout: string): TranscriptionResult => {
	const trimmed = Str.trim(stdout)
	if (trimmed.length === 0) {
		return emptyTranscriptionResult
	}
	const parsed = decodeExternalJson(trimmed)
	if (Option.isNone(parsed)) {
		return {
			text: trimmed,
			language: null,
			durationMs: 0
		}
	}
	const language = parsed.value.language
	return {
		text: Str.trim(parsed.value.text),
		language: language === undefined ? null : language,
		durationMs: 0
	}
}
