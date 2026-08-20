import * as Effect from "effect/Effect"

export const fromPromise = <A, E>(
	evaluate: (signal: AbortSignal) => PromiseLike<A>,
	onError: (cause: unknown) => E
): Effect.Effect<A, E> =>
	Effect.tryPromise({
		try: evaluate,
		catch: onError
	})
