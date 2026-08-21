import {
	applyEventToRpcSessionSnapshot,
	emptyRpcSessionSnapshot,
	type RpcClient,
	type SessionId,
} from "@acepe/contracts";
import { atomState } from "@acepe/effect-svelte/atom";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export const createSessionStore = (input: {
	readonly client: RpcClient;
	readonly registry: AtomRegistry.AtomRegistry;
}) => {
	const snapshotAtom = Atom.make(emptyRpcSessionSnapshot(0));
	const snapshot = atomState(snapshotAtom, input.registry);

	const openSession = Effect.fn("openSession")(function* (sessionId: SessionId) {
		const snap = yield* input.client.snapshot(sessionId);
		input.registry.set(snapshotAtom, snap);
		yield* input.client.events(snap.snapshotSequence).pipe(
			Stream.runForEach((event) =>
				Effect.sync(() => {
					const current = input.registry.get(snapshotAtom);
					input.registry.set(
						snapshotAtom,
						applyEventToRpcSessionSnapshot(current, event),
					);
				}),
			),
		);
	});

	return {
		snapshot,
		snapshotAtom,
		openSession,
		dispatch: input.client.dispatch,
	};
};
