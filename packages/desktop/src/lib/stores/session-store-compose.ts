import {
	applyEventToRpcSessionSnapshot,
	type CommandId,
	emptyRpcSessionSnapshot,
	type OrchestrationEvent,
	type RpcClient,
	type SessionId,
	type SessionPrLinkMode,
	type SessionPrNumber,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { type SessionSendMoment, sessionStoreView } from "./session-store-optimistic.ts";
import { prLinkToggleCommand, shouldDispatchPrLinkToggle } from "./session-store-pr-link.ts";

export type { SessionSendMoment };

export const composeSessionStore = (input: {
	readonly client: RpcClient;
	readonly registry: AtomRegistry.AtomRegistry;
}) => {
	const snapshotAtom = Atom.make(emptyRpcSessionSnapshot(0));
	const sendMomentAtom = Atom.make<SessionSendMoment | null>(null);

	const readSnapshot = () => input.registry.get(snapshotAtom);
	const readSendMoment = () => input.registry.get(sendMomentAtom);

	const applyLiveEvent = (event: OrchestrationEvent) => {
		input.registry.set(snapshotAtom, applyEventToRpcSessionSnapshot(readSnapshot(), event));
	};

	const openSession = Effect.fn("openSession")(function* (sessionId: SessionId) {
		const snap = yield* input.client.snapshot(sessionId);
		input.registry.set(snapshotAtom, snap);
		yield* input.client
			.events(snap.snapshotSequence)
			.pipe(Stream.runForEach((event) => Effect.sync(() => applyLiveEvent(event))));
	});

	const togglePrLink = Effect.fn("togglePrLink")(function* (commandInput: {
		readonly commandId: CommandId;
		readonly sessionId: SessionId;
		readonly prNumber: SessionPrNumber | null;
		readonly prLinkMode: SessionPrLinkMode;
	}) {
		const snapshot = readSnapshot();
		if (
			!shouldDispatchPrLinkToggle({
				snapshot,
				prLinkMode: commandInput.prLinkMode,
			})
		) {
			return { sequence: snapshot.snapshotSequence };
		}
		return yield* input.client.dispatch(prLinkToggleCommand(commandInput));
	});

	const view = () =>
		sessionStoreView({
			snapshot: readSnapshot(),
			sendMoment: readSendMoment(),
		});

	return {
		snapshotAtom,
		sendMomentAtom,
		openSession,
		dispatch: input.client.dispatch,
		recordSendMoment: (moment: SessionSendMoment) => {
			input.registry.set(sendMomentAtom, moment);
		},
		togglePrLink,
		headerTitle: () => view().headerTitle,
		showWorkingSpark: () => view().showWorkingSpark,
	};
};
