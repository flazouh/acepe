import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { MicrophoneUnavailableError } from "../Errors.ts"
import {
	type CaptureSession,
	DEFAULT_CAPTURE_SAMPLE_RATE,
	MicrophoneCapture,
	type MicrophoneCaptureShape,
	NO_MICROPHONE_MESSAGE
} from "../Services/MicrophoneCapture.ts"

export type QueueMicrophoneCapture = {
	readonly capture: MicrophoneCaptureShape
	readonly push: (samples: ReadonlyArray<number>) => Effect.Effect<void>
	readonly failStart: (detail: string) => Effect.Effect<void>
	readonly failCapture: (detail: string) => Effect.Effect<void>
}

export const makeQueueMicrophoneCapture = Effect.fn("QueueMicrophoneCapture.make")(function*() {
	const buffer = yield* Ref.make<ReadonlyArray<number>>([])
	const deviceError = yield* Ref.make(Option.none<string>())
	const available = yield* Ref.make(true)
	const unavailableDetail = yield* Ref.make(NO_MICROPHONE_MESSAGE)

	const start = Effect.fn("QueueMicrophoneCapture.start")(function*() {
		const ok = yield* Ref.get(available)
		if (ok === false) {
			return yield* new MicrophoneUnavailableError({
				detail: yield* Ref.get(unavailableDetail)
			})
		}
		const session: CaptureSession = {
			sampleRate: DEFAULT_CAPTURE_SAMPLE_RATE,
			pull: Effect.fn("QueueMicrophoneCapture.pull")(function*() {
				return yield* Ref.modify(buffer, (current) => [current, Arr.empty<number>()])
			}),
			takeError: Effect.fn("QueueMicrophoneCapture.takeError")(function*() {
				return yield* Ref.modify(deviceError, (current) => [current, Option.none<string>()])
			}),
			stop: Effect.fn("QueueMicrophoneCapture.stop")(function*() {
				return yield* Effect.void
			})
		}
		return session
	})

	const push = Effect.fn("QueueMicrophoneCapture.push")(function*(samples: ReadonlyArray<number>) {
		yield* Ref.update(buffer, (current) => Arr.appendAll(current, samples))
	})

	const failStart = Effect.fn("QueueMicrophoneCapture.failStart")(function*(detail: string) {
		yield* Ref.set(available, false)
		yield* Ref.set(unavailableDetail, detail)
	})

	const failCapture = Effect.fn("QueueMicrophoneCapture.failCapture")(function*(detail: string) {
		yield* Ref.set(deviceError, Option.some(detail))
	})

	return {
		capture: MicrophoneCapture.of({ start }),
		push,
		failStart,
		failCapture
	} satisfies QueueMicrophoneCapture
})
