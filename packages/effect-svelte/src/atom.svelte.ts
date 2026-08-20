import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { createSubscriber } from "svelte/reactivity";

export interface AtomState<A> {
	readonly current: A;
}

export const atomState = <A>(
	atom: Atom.Atom<A>,
	registry: AtomRegistry.AtomRegistry,
): AtomState<A> => {
	const subscribe = createSubscriber((update) =>
		registry.subscribe(atom, update),
	);
	return {
		get current(): A {
			subscribe();
			return registry.get(atom);
		},
	};
};
