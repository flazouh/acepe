import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

export class RuntimeAlreadyBound extends Data.TaggedError(
	"RuntimeAlreadyBound",
)<{}> {}

export class RuntimeNotBound extends Data.TaggedError("RuntimeNotBound")<{}> {}

type Runner = {
	readonly runPromise: <A, E, R>(
		program: Effect.Effect<A, E, R>,
		options?: Effect.RunOptions,
	) => Promise<A>;
	readonly runCallback: <A, E, R>(
		program: Effect.Effect<A, E, R>,
		options?: Effect.RunOptions & {
			readonly onExit: (exit: Exit.Exit<A, E>) => void;
		},
	) => (interruptor?: number | undefined) => void;
};

let runner: Runner | undefined;

export const bindRuntime = <R, ER>(
	layer: Layer.Layer<R, ER, never>,
): ManagedRuntime.ManagedRuntime<R, ER> => {
	if (runner !== undefined) {
		throw new RuntimeAlreadyBound();
	}
	const created = ManagedRuntime.make(layer);
	runner = {
		runPromise: created.runPromise as Runner["runPromise"],
		runCallback: created.runCallback as Runner["runCallback"],
	};
	return created;
};

const requireRunner = (): Runner => {
	if (runner === undefined) {
		throw new RuntimeNotBound();
	}
	return runner;
};

export const runtime = {
	get runPromise() {
		return requireRunner().runPromise;
	},
	get runCallback() {
		return requireRunner().runCallback;
	},
};
