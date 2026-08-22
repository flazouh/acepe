import type { RpcClient } from "@acepe/contracts";
import { atomState } from "@acepe/effect-svelte/atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { composeSessionStore } from "./session-store-compose.ts";
import { sessionStoreView } from "./session-store-optimistic.ts";

export const createSessionStore = (input: {
	readonly client: RpcClient;
	readonly registry: AtomRegistry.AtomRegistry;
}) => {
	const parts = composeSessionStore(input);
	const snapshot = atomState(parts.snapshotAtom, input.registry);
	const sendMoment = atomState(parts.sendMomentAtom, input.registry);

	return {
		snapshot,
		snapshotAtom: parts.snapshotAtom,
		openLibrary: parts.openLibrary,
		openSession: parts.openSession,
		dispatch: parts.dispatch,
		recordSendMoment: parts.recordSendMoment,
		togglePrLink: parts.togglePrLink,
		get headerTitle(): string | null {
			return sessionStoreView({
				snapshot: snapshot.current,
				sendMoment: sendMoment.current,
			}).headerTitle;
		},
		get showWorkingSpark(): boolean {
			return sessionStoreView({
				snapshot: snapshot.current,
				sendMoment: sendMoment.current,
			}).showWorkingSpark;
		},
	};
};
