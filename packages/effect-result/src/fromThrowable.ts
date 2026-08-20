import * as Effect from "effect/Effect"

export const fromThrowable = <A, E, Args extends ReadonlyArray<unknown>>(
	evaluate: (...args: Args) => A,
	onError: (cause: unknown) => E
): (...args: Args) => Effect.Effect<A, E> =>
	(...args) =>
		Effect.try({
			try: () => evaluate(...args),
			catch: onError
		})
