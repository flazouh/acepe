import type { TerminalId } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SynchronizedRef from "effect/SynchronizedRef"
import {
	TerminalRegistry,
	TerminalRegistryLookupError,
	type TerminalRegistryEntry
} from "../Services/TerminalRegistry.ts"

export const makeTerminalRegistry = Effect.fn("TerminalRegistry.make")(function*() {
	const entries = yield* SynchronizedRef.make(HashMap.empty<TerminalId, TerminalRegistryEntry>())

	const register = (terminalId: TerminalId, entry: TerminalRegistryEntry) =>
		SynchronizedRef.update(entries, (current) => HashMap.set(current, terminalId, entry))

	const require_ = Effect.fn("TerminalRegistry.require")(function*(terminalId: TerminalId) {
		const found = HashMap.get(yield* SynchronizedRef.get(entries), terminalId)
		if (Option.isNone(found)) {
			return yield* new TerminalRegistryLookupError({ terminalId })
		}
		return found.value
	})

	const updateSize = Effect.fn("TerminalRegistry.updateSize")(function*(
		terminalId: TerminalId,
		cols: TerminalRegistryEntry["cols"],
		rows: TerminalRegistryEntry["rows"]
	) {
		const current = yield* require_(terminalId)
		yield* register(terminalId, { ...current, cols, rows })
	})

	const remove = (terminalId: TerminalId) =>
		SynchronizedRef.update(entries, (current) => HashMap.remove(current, terminalId))

	return TerminalRegistry.of({
		register,
		require: require_,
		updateSize,
		remove
	})
})

export const TerminalRegistryLive = Layer.effect(TerminalRegistry, makeTerminalRegistry())
