import * as Vitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as TestClock from "effect/testing/TestClock"
import { FILE_INDEX_CACHE_TTL_MS, makeIndexCache } from "./indexCache.ts"

Vitest.describe("IndexCache", () => {
	Vitest.it.effect("returns the cached value without calling fetch again", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, never>(FILE_INDEX_CACHE_TTL_MS)
			const fetches = yield* Ref.make(0)
			const fetch = Ref.update(fetches, (count) => count + 1).pipe(Effect.as("first"))
			const first = yield* cache.getOrFetch("project", fetch)
			const second = yield* cache.getOrFetch(
				"project",
				Ref.update(fetches, (count) => count + 1).pipe(Effect.as("second"))
			)
			const count = yield* Ref.get(fetches)
			Vitest.assert.strictEqual(first, "first")
			Vitest.assert.strictEqual(second, "first")
			Vitest.assert.strictEqual(count, 1)
		})
	)

	Vitest.it.effect("re-fetches after the TTL expires", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, never>(FILE_INDEX_CACHE_TTL_MS)
			const fetches = yield* Ref.make(0)
			yield* cache.getOrFetch(
				"project",
				Ref.update(fetches, (count) => count + 1).pipe(Effect.as("first"))
			)
			yield* TestClock.adjust(Duration.millis(FILE_INDEX_CACHE_TTL_MS + 1))
			const second = yield* cache.getOrFetch(
				"project",
				Ref.update(fetches, (count) => count + 1).pipe(Effect.as("second"))
			)
			const count = yield* Ref.get(fetches)
			Vitest.assert.strictEqual(second, "second")
			Vitest.assert.strictEqual(count, 2)
		})
	)

	Vitest.it.effect("coalesces concurrent fetches for one key", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, never>(FILE_INDEX_CACHE_TTL_MS)
			const fetches = yield* Ref.make(0)
			const started = yield* Deferred.make<void>()
			const release = yield* Deferred.make<void>()
			const fetch = Effect.gen(function*() {
				yield* Ref.update(fetches, (count) => count + 1)
				yield* Deferred.succeed(started, undefined)
				yield* Deferred.await(release)
				return "shared"
			})
			const first = yield* Effect.forkChild(cache.getOrFetch("project", fetch))
			yield* Deferred.await(started)
			const second = yield* Effect.forkChild(
				cache.getOrFetch(
					"project",
					Ref.update(fetches, (count) => count + 1).pipe(Effect.as("other"))
				)
			)
			yield* Deferred.succeed(release, undefined)
			const firstValue = yield* Fiber.join(first)
			const secondValue = yield* Fiber.join(second)
			const count = yield* Ref.get(fetches)
			Vitest.assert.strictEqual(firstValue, "shared")
			Vitest.assert.strictEqual(secondValue, "shared")
			Vitest.assert.strictEqual(count, 1)
		})
	)

	Vitest.it.effect("does not cache a failed fetch", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, string>(FILE_INDEX_CACHE_TTL_MS)
			const first = yield* Effect.flip(cache.getOrFetch("project", Effect.fail("boom")))
			const second = yield* cache.getOrFetch("project", Effect.succeed("ok"))
			Vitest.assert.strictEqual(first, "boom")
			Vitest.assert.strictEqual(second, "ok")
		})
	)

	Vitest.it.effect("peeks a stale cached value without fetching", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, never>(FILE_INDEX_CACHE_TTL_MS)
			yield* cache.getOrFetch("project", Effect.succeed("old"))
			yield* TestClock.adjust(Duration.millis(FILE_INDEX_CACHE_TTL_MS + 1))
			const peeked = yield* cache.peek("project")
			Vitest.assert.deepStrictEqual(peeked, Option.some("old"))
		})
	)

	Vitest.it.effect("updates a cached value without fetching", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, never>(FILE_INDEX_CACHE_TTL_MS)
			yield* cache.getOrFetch("project", Effect.succeed("old"))
			const updated = yield* cache.updateCached("project", "new")
			const missing = yield* cache.updateCached("other", "nope")
			const read = yield* cache.getOrFetch("project", Effect.succeed("fetched"))
			Vitest.assert.deepStrictEqual(updated, Option.some("new"))
			Vitest.assert.deepStrictEqual(missing, Option.none())
			Vitest.assert.strictEqual(read, "new")
		})
	)

	Vitest.it.effect("invalidates so the next read fetches again", () =>
		Effect.gen(function*() {
			const cache = yield* makeIndexCache<string, never>(FILE_INDEX_CACHE_TTL_MS)
			yield* cache.getOrFetch("project", Effect.succeed("old"))
			yield* cache.invalidate("project")
			const read = yield* cache.getOrFetch("project", Effect.succeed("fresh"))
			Vitest.assert.strictEqual(read, "fresh")
		})
	)
})
