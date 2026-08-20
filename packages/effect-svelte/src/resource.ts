import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { createSubscriber } from "svelte/reactivity";
import { runtime } from "./runtime.ts";

export interface Resource<A, E> {
	readonly loading: boolean;
	readonly success: A | undefined;
	readonly failure: E | undefined;
}

type Snapshot<A, E> =
	| { readonly _tag: "Loading" }
	| { readonly _tag: "Success"; readonly value: A }
	| { readonly _tag: "Failure"; readonly error: E };

const snapshotFromExit = <A, E>(exit: Exit.Exit<A, E>): Snapshot<A, E> => {
	if (Exit.isSuccess(exit)) {
		return { _tag: "Success", value: exit.value };
	}
	const error = Exit.findErrorOption(exit).pipe(Option.getOrUndefined);
	if (error === undefined) {
		return { _tag: "Loading" };
	}
	return { _tag: "Failure", error };
};

export const resource = <A, E, R>(
	program: Effect.Effect<A, E, R>,
): Resource<A, E> => {
	let snapshot: Snapshot<A, E> = { _tag: "Loading" };
	const subscribe = createSubscriber((update) => {
		let active = true;
		const cancel = runtime.runCallback(program, {
			onExit: (exit) => {
				if (active === false) {
					return;
				}
				snapshot = snapshotFromExit(exit);
				update();
			},
		});
		return () => {
			active = false;
			cancel();
		};
	});
	return {
		get loading() {
			subscribe();
			return snapshot._tag === "Loading";
		},
		get success() {
			subscribe();
			return snapshot._tag === "Success" ? snapshot.value : undefined;
		},
		get failure() {
			subscribe();
			return snapshot._tag === "Failure" ? snapshot.error : undefined;
		},
	};
};
