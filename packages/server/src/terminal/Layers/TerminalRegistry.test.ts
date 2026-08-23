import { SessionId, TerminalId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { TerminalRegistry } from "../Services/TerminalRegistry.ts"
import { TerminalRegistryLive } from "./TerminalRegistry.ts"

const terminalId = TerminalId.make("term-1")
const sessionId = SessionId.make("session-1")

Vitest.layer(TerminalRegistryLive)("TerminalRegistry", (it) => {
	it.effect("looks up a registered terminal by its contract id", () =>
		Effect.gen(function*() {
			const registry = yield* TerminalRegistry
			yield* registry.register(terminalId, {
				serverTerminalId: "pty-1" as never,
				sessionId,
				cwd: "/tmp" as never,
				cols: 80 as never,
				rows: 24 as never
			})
			const found = yield* registry.require(terminalId)
			Vitest.assert.strictEqual(found.sessionId, sessionId)
			Vitest.assert.strictEqual(found.cols, 80)
		})
	)

	it.effect("fails with a lookup error for an unknown terminal", () =>
		Effect.gen(function*() {
			// Layer state is shared across `it.effect` cases in this block (see
			// TerminalService.test.ts for the same convention), so this uses a
			// terminal id no other case registers.
			const registry = yield* TerminalRegistry
			const neverRegistered = TerminalId.make("term-never-registered")
			const error = yield* registry.require(neverRegistered).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "TerminalRegistryLookupError")
		})
	)

	it.effect("updateSize replaces cols/rows and preserves the rest", () =>
		Effect.gen(function*() {
			const registry = yield* TerminalRegistry
			yield* registry.register(terminalId, {
				serverTerminalId: "pty-1" as never,
				sessionId,
				cwd: "/tmp" as never,
				cols: 80 as never,
				rows: 24 as never
			})
			yield* registry.updateSize(terminalId, 120 as never, 40 as never)
			const found = yield* registry.require(terminalId)
			Vitest.assert.strictEqual(found.cols, 120)
			Vitest.assert.strictEqual(found.rows, 40)
			Vitest.assert.strictEqual(found.sessionId, sessionId)
		})
	)

	it.effect("remove clears the entry", () =>
		Effect.gen(function*() {
			const registry = yield* TerminalRegistry
			yield* registry.register(terminalId, {
				serverTerminalId: "pty-1" as never,
				sessionId,
				cwd: "/tmp" as never,
				cols: 80 as never,
				rows: 24 as never
			})
			yield* registry.remove(terminalId)
			const error = yield* registry.require(terminalId).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "TerminalRegistryLookupError")
		})
	)
})
