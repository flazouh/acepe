import {
	applyEventToRpcSessionSnapshot,
	type CommandId,
	emptyRpcSessionSnapshot,
	type OrchestrationEvent,
	type ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
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
	readonly onSnapshot?: (snapshot: RpcSessionSnapshot) => void;
}) => {
	const snapshotAtom = Atom.make(emptyRpcSessionSnapshot(0));
	const sendMomentAtom = Atom.make<SessionSendMoment | null>(null);

	const readSnapshot = () => input.registry.get(snapshotAtom);
	const readSendMoment = () => input.registry.get(sendMomentAtom);

	const replaceSnapshot = (snapshot: RpcSessionSnapshot) => {
		input.registry.set(snapshotAtom, snapshot);
		if (input.onSnapshot !== undefined) {
			input.onSnapshot(snapshot);
		}
	};

	const applyLiveEvent = (event: OrchestrationEvent) => {
		replaceSnapshot(applyEventToRpcSessionSnapshot(readSnapshot(), event));
	};

	// The library scope reads projects without opening any session, so the
	// sidebar can render before a session is selected. Same snapshot primitive,
	// different scope — no fourth RPC primitive.
	const openLibrary = Effect.fn("openLibrary")(function* () {
		const snap = yield* input.client.snapshot({ kind: "library" });
		replaceSnapshot(snap);
		return snap;
	});

	// Project scope returns that project's sessions without opening one of them,
	// so the sidebar can list them before a selection is made.
	const openProject = Effect.fn("openProject")(function* (projectId: ProjectId) {
		const snap = yield* input.client.snapshot({ kind: "project", projectId });
		replaceSnapshot(snap);
		return snap;
	});

	const openSession = Effect.fn("openSession")(function* (sessionId: SessionId) {
		const snap = yield* input.client.snapshot({ sessionId });
		replaceSnapshot(snap);
		yield* input.client
			.events(snap.snapshotSequence)
			.pipe(Stream.runForEach((event) => Effect.sync(() => applyLiveEvent(event))));
	});

	const refreshSession = Effect.fn("refreshSession")(function* (sessionId: SessionId) {
		const snap = yield* input.client.snapshot({ sessionId });
		replaceSnapshot(snap);
		return snap;
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
		openLibrary,
		openProject,
		openSession,
		refreshSession,
		dispatch: input.client.dispatch,
		recordSendMoment: (moment: SessionSendMoment) => {
			input.registry.set(sendMomentAtom, moment);
		},
		togglePrLink,
		headerTitle: () => view().headerTitle,
		showWorkingSpark: () => view().showWorkingSpark,
	};
};
