/**
 * Drives a scenario's event stream and owns playback.
 *
 * The player is the only thing that decides when a recorded event becomes
 * visible, which is what makes stepping, pausing and rate changes possible
 * without touching the app. Control commands work by interrupting and
 * re-forking the driver fiber, so there is no polling and no race between a
 * control and a pending sleep.
 */

import type { OrchestrationEvent, Sequence } from "@acepe/contracts"
import * as Arr from "effect/Array"
import type * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import type { QaScenarioStepLine } from "./scenario.ts"
import { clampCursor, delayBeforeStep, scaleDelayMs } from "./timeline.ts"

export type PlaybackMode = "playing" | "paused"

export type ScenarioPlaybackState = {
	readonly mode: PlaybackMode
	/** Index of the next step to emit. */
	readonly cursor: number
	readonly total: number
	readonly rate: number
	/** Highest sequence emitted so far, 0 before anything went out. */
	readonly lastSequence: Sequence
}

export type ScenarioPlayerOptions = {
	/** Start playing on creation. False leaves the scenario parked at step 0. */
	readonly autoPlay: boolean
	/** 1 is capture speed. 0 removes every delay, which is what CI wants. */
	readonly rate: number
}

export const defaultPlayerOptions: ScenarioPlayerOptions = {
	autoPlay: true,
	rate: 1,
}

export type ScenarioPlayer = {
	readonly events: (fromSequence: Sequence) => Stream.Stream<OrchestrationEvent>
	readonly state: Effect.Effect<ScenarioPlaybackState>
	readonly play: Effect.Effect<void>
	readonly pause: Effect.Effect<void>
	/** Emit exactly one event, ignoring its recorded delay. Leaves playback paused. */
	readonly stepOnce: Effect.Effect<void>
	/** Emit every step up to and including `index`, with no waiting. Leaves playback paused. */
	readonly seekTo: (index: number) => Effect.Effect<void>
	readonly setRate: (rate: number) => Effect.Effect<void>
	/** Completes once the last recorded step has been emitted. */
	readonly awaitDrained: Effect.Effect<void>
	readonly shutdown: Effect.Effect<void>
}

type Subscriber = Queue.Queue<OrchestrationEvent, Cause.Done>

export const makeScenarioPlayer = Effect.fn("makeScenarioPlayer")(function* (
	steps: ReadonlyArray<QaScenarioStepLine>,
	options: ScenarioPlayerOptions = defaultPlayerOptions,
) {
	const total = steps.length
	const cursorRef = yield* Ref.make(0)
	const rateRef = yield* Ref.make(options.rate)
	const modeRef = yield* Ref.make<PlaybackMode>("paused")
	const emittedRef = yield* Ref.make<ReadonlyArray<OrchestrationEvent>>([])
	const subscribersRef = yield* Ref.make<ReadonlyArray<Subscriber>>([])
	const driverRef = yield* Ref.make<Option.Option<Fiber.Fiber<void>>>(Option.none())
	const drained = yield* Deferred.make<void>()

	const lastSequenceOf = (events: ReadonlyArray<OrchestrationEvent>): Sequence => {
		const last = events[events.length - 1]
		return last === undefined ? 0 : last.sequence
	}

	const emitAt = Effect.fn("ScenarioPlayer.emitAt")(function* (index: number) {
		const step = steps[index]
		if (step === undefined) {
			return
		}
		yield* Ref.update(emittedRef, (events) => Arr.append(events, step.event))
		const subscribers = yield* Ref.get(subscribersRef)
		yield* Effect.forEach(subscribers, (queue) => Queue.offer(queue, step.event), {
			discard: true,
		})
		const next = index + 1
		yield* Ref.set(cursorRef, next)
		if (next >= total) {
			yield* Deferred.succeed(drained, undefined)
		}
	})

	const driver = Effect.gen(function* () {
		while (true) {
			const cursor = yield* Ref.get(cursorRef)
			if (cursor >= total) {
				return
			}
			const rate = yield* Ref.get(rateRef)
			const delay = scaleDelayMs(delayBeforeStep(steps, cursor), rate)
			if (delay > 0) {
				yield* Effect.sleep(Duration.millis(delay))
			}
			yield* emitAt(cursor)
		}
	})

	const stopDriver = Effect.gen(function* () {
		const running = yield* Ref.get(driverRef)
		if (Option.isSome(running)) {
			yield* Fiber.interrupt(running.value)
			yield* Ref.set(driverRef, Option.none())
		}
	})

	const startDriver = Effect.gen(function* () {
		yield* stopDriver
		const fiber = yield* Effect.forkDetach(driver)
		yield* Ref.set(driverRef, Option.some(fiber))
	})

	const play = Effect.gen(function* () {
		yield* Ref.set(modeRef, "playing")
		yield* startDriver
	})

	const pause = Effect.gen(function* () {
		yield* Ref.set(modeRef, "paused")
		yield* stopDriver
	})

	const stepOnce = Effect.gen(function* () {
		yield* pause
		const cursor = yield* Ref.get(cursorRef)
		yield* emitAt(cursor)
	})

	const seekTo = Effect.fn("ScenarioPlayer.seekTo")(function* (index: number) {
		yield* pause
		const target = clampCursor(index + 1, total)
		let cursor = yield* Ref.get(cursorRef)
		while (cursor < target) {
			yield* emitAt(cursor)
			cursor = cursor + 1
		}
	})

	const setRate = Effect.fn("ScenarioPlayer.setRate")(function* (rate: number) {
		yield* Ref.set(rateRef, rate)
		const mode = yield* Ref.get(modeRef)
		if (mode === "playing") {
			yield* startDriver
		}
	})

	const state = Effect.gen(function* () {
		const mode = yield* Ref.get(modeRef)
		const cursor = yield* Ref.get(cursorRef)
		const rate = yield* Ref.get(rateRef)
		const emitted = yield* Ref.get(emittedRef)
		return {
			mode,
			cursor,
			total,
			rate,
			lastSequence: lastSequenceOf(emitted),
		} satisfies ScenarioPlaybackState
	})

	/**
	 * Registering before reading the backlog can duplicate an event that lands
	 * in between, never drop one. The `seen` cursor removes the duplicate, so a
	 * subscriber always gets every event exactly once, in order.
	 */
	const events = (fromSequence: Sequence): Stream.Stream<OrchestrationEvent> =>
		Stream.unwrap(
			Effect.gen(function* () {
				const queue = yield* Queue.unbounded<OrchestrationEvent, Cause.Done>()
				yield* Ref.update(subscribersRef, (list) => Arr.append(list, queue))
				const backlog = yield* Ref.get(emittedRef)
				const seen = yield* Ref.make<Sequence>(fromSequence)
				const keepUnseen = (event: OrchestrationEvent) =>
					Ref.get(seen).pipe(
						Effect.flatMap((last) =>
							event.sequence > last
								? Ref.set(seen, event.sequence).pipe(Effect.as(true))
								: Effect.succeed(false),
						),
					)
				return Stream.concat(
					Stream.fromArray(backlog),
					Stream.fromQueue(queue),
				).pipe(Stream.filterEffect(keepUnseen))
			}),
		)

	const shutdown = Effect.gen(function* () {
		yield* stopDriver
		const subscribers = yield* Ref.get(subscribersRef)
		yield* Effect.forEach(subscribers, (queue) => Queue.end(queue), { discard: true })
		yield* Ref.set(subscribersRef, [])
	})

	if (options.autoPlay) {
		yield* play
	}

	return {
		events,
		state,
		play,
		pause,
		stepOnce,
		seekTo,
		setRate,
		awaitDrained: Deferred.await(drained),
		shutdown,
	} satisfies ScenarioPlayer
})
