import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	closeFd,
	getWinsize,
	openPtyPair,
	PtyFfiError,
	readFd,
	setNonblock,
	setWinsize,
	writeFd
} from "./ptyFfi.ts"

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const decodePrefix = (buffer: Uint8Array, n: number): string =>
	new TextDecoder().decode(buffer.subarray(0, n))

Vitest.describe("PtyFfiError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new PtyFfiError({
					operation: "openpty",
					errno: 1,
					detail: "EPERM"
				})
			)
			Vitest.assert.strictEqual(error._tag, "PtyFfiError")
			Vitest.assert.isTrue(Schema.is(PtyFfiError)(error))
			Vitest.assert.strictEqual(error.message, "PTY FFI openpty failed (errno 1): EPERM")
		})
	)
})

Vitest.it.live(
	"openpty returns a live master/slave pair that echoes PTY_ALIVE_42",
	() =>
		Effect.gen(function*() {
			const pair = yield* openPtyPair({ cols: 80, rows: 24 })
			Vitest.assert.isTrue(pair.master >= 0)
			Vitest.assert.isTrue(pair.slave >= 0)
			Vitest.assert.notStrictEqual(pair.master, pair.slave)
			const payload = "PTY_ALIVE_42"
			const wrote = writeFd(pair.slave, encode(payload))
			Vitest.assert.strictEqual(wrote, payload.length)
			const buffer = new Uint8Array(64)
			const n = readFd(pair.master, buffer)
			Vitest.assert.isTrue(n > 0)
			Vitest.assert.isTrue(decodePrefix(buffer, n).includes(payload))
			Vitest.assert.strictEqual(closeFd(pair.master), 0)
			Vitest.assert.strictEqual(closeFd(pair.slave), 0)
		}),
	10_000
)

Vitest.it.live(
	"TIOCSWINSZ then TIOCGWINSZ round-trips rows and cols",
	() =>
		Effect.gen(function*() {
			const pair = yield* openPtyPair({ cols: 80, rows: 24 })
			const initial = yield* getWinsize(pair.master)
			Vitest.assert.strictEqual(initial.cols, 80)
			Vitest.assert.strictEqual(initial.rows, 24)
			yield* setWinsize(pair.master, { cols: 60, rows: 20 })
			const resized = yield* getWinsize(pair.master)
			Vitest.assert.strictEqual(resized.cols, 60)
			Vitest.assert.strictEqual(resized.rows, 20)
			Vitest.assert.strictEqual(closeFd(pair.master), 0)
			Vitest.assert.strictEqual(closeFd(pair.slave), 0)
		}),
	10_000
)

Vitest.it.live(
	"close releases both fds; a later close does not succeed",
	() =>
		Effect.gen(function*() {
			const pair = yield* openPtyPair({ cols: 80, rows: 24 })
			yield* setNonblock(pair.master)
			Vitest.assert.strictEqual(closeFd(pair.master), 0)
			Vitest.assert.strictEqual(closeFd(pair.slave), 0)
			Vitest.assert.notStrictEqual(closeFd(pair.master), 0)
			Vitest.assert.notStrictEqual(closeFd(pair.slave), 0)
		}),
	10_000
)
