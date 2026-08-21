import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as SynchronizedRef from "effect/SynchronizedRef"

export const FILE_INDEX_CACHE_TTL_MS = 60_000

export type IndexCacheEntry<A> = {
	readonly value: A
	readonly storedAtMs: number
}

export type IndexCacheState<A, E> = {
	readonly entries: HashMap.HashMap<string, IndexCacheEntry<A>>
	readonly inflight: HashMap.HashMap<string, Deferred.Deferred<A, E>>
}

type CacheDecision<A, E> =
	| { readonly _tag: "Hit"; readonly value: A }
	| { readonly _tag: "Stale"; readonly value: A }
	| { readonly _tag: "Wait"; readonly deferred: Deferred.Deferred<A, E> }
	| { readonly _tag: "Fetch"; readonly deferred: Deferred.Deferred<A, E> }

const emptyState = <A, E>(): IndexCacheState<A, E> => ({
	entries: HashMap.empty(),
	inflight: HashMap.empty()
})

const isFresh = (storedAtMs: number, nowMs: number, ttlMs: number): boolean =>
	nowMs - storedAtMs <= ttlMs

export type IndexCache<A, E> = {
	readonly getOrFetch: <R = never>(
		key: string,
		fetch: Effect.Effect<A, E, R>
	) => Effect.Effect<A, E, R>
	readonly peek: (key: string) => Effect.Effect<Option.Option<A>>
	readonly updateCached: (key: string, next: A) => Effect.Effect<Option.Option<A>>
	readonly invalidate: (key: string) => Effect.Effect<void>
}

const decide = <A, E>(
	current: IndexCacheState<A, E>,
	key: string,
	nowMs: number,
	ttlMs: number
): Effect.Effect<readonly [CacheDecision<A, E>, IndexCacheState<A, E>]> => {
	const cached = HashMap.get(current.entries, key)
	if (Option.isSome(cached) && isFresh(cached.value.storedAtMs, nowMs, ttlMs) === true) {
		return Effect.succeed([{ _tag: "Hit", value: cached.value.value }, current])
	}
	const pending = HashMap.get(current.inflight, key)
	if (Option.isSome(pending)) {
		if (Option.isSome(cached)) {
			return Effect.succeed([{ _tag: "Stale", value: cached.value.value }, current])
		}
		return Effect.succeed([{ _tag: "Wait", deferred: pending.value }, current])
	}
	return Deferred.make<A, E>().pipe(
		Effect.map((deferred) => [
			{ _tag: "Fetch", deferred } as const,
			{
				entries: current.entries,
				inflight: HashMap.set(current.inflight, key, deferred)
			}
		])
	)
}

export const makeIndexCache = <A, E>(ttlMs: number): Effect.Effect<IndexCache<A, E>> =>
	Effect.gen(function*() {
		const state = yield* SynchronizedRef.make(emptyState<A, E>())

		const getOrFetch = <R = never>(
			key: string,
			fetch: Effect.Effect<A, E, R>
		): Effect.Effect<A, E, R> =>
			Effect.gen(function*() {
				const nowMs = yield* Clock.currentTimeMillis
				const decision = yield* SynchronizedRef.modifyEffect(state, (current) =>
					decide(current, key, nowMs, ttlMs)
				)
				if (decision._tag === "Hit" || decision._tag === "Stale") {
					return decision.value
				}
				if (decision._tag === "Wait") {
					return yield* Deferred.await(decision.deferred)
				}
				const exit = yield* Effect.exit(fetch)
				const storedAtMs = yield* Clock.currentTimeMillis
				yield* SynchronizedRef.update(state, (current) => ({
					entries: Exit.isSuccess(exit)
						? HashMap.set(current.entries, key, { value: exit.value, storedAtMs })
						: current.entries,
					inflight: HashMap.remove(current.inflight, key)
				}))
				yield* Deferred.done(decision.deferred, exit)
				if (Exit.isSuccess(exit)) {
					return exit.value
				}
				return yield* Effect.failCause(exit.cause)
			})

		const peek = (key: string): Effect.Effect<Option.Option<A>> =>
			SynchronizedRef.get(state).pipe(
				Effect.map((current) => Option.map(HashMap.get(current.entries, key), (entry) => entry.value))
			)

		const updateCached = (key: string, next: A): Effect.Effect<Option.Option<A>> =>
			Clock.currentTimeMillis.pipe(
				Effect.flatMap((storedAtMs) =>
					SynchronizedRef.modify(state, (current) => {
						const cached = HashMap.get(current.entries, key)
						if (Option.isNone(cached)) {
							return [Option.none(), current]
						}
						return [
							Option.some(next),
							{
								entries: HashMap.set(current.entries, key, { value: next, storedAtMs }),
								inflight: current.inflight
							}
						]
					})
				)
			)

		const invalidate = (key: string): Effect.Effect<void> =>
			SynchronizedRef.update(state, (current) => ({
				entries: HashMap.remove(current.entries, key),
				inflight: current.inflight
			}))

		return {
			getOrFetch,
			peek,
			updateCached,
			invalidate
		}
	})
