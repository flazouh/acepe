import {
	applyEventToRpcSessionSnapshot,
	type CommandId,
	emptyRpcSessionSnapshot,
	type OrchestrationEvent,
	type ProjectId,
	type RpcClient,
	type RpcProjectedProject,
	type RpcProjectedSession,
	type RpcSessionSnapshot,
	type SessionId,
	type SessionPrLinkMode,
	type SessionPrNumber,
} from "@acepe/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { type SessionSendMoment, sessionStoreView } from "./session-store-optimistic.ts";
import { prLinkToggleCommand, shouldDispatchPrLinkToggle } from "./session-store-pr-link.ts";

export type { SessionSendMoment };

// A scoped snapshot request (project or session) narrows `projects`/`sessions`
// to what that scope needs — server-side, on purpose. Replacing the store
// wholesale with a narrowed snapshot would make every OTHER project vanish
// from the sidebar, since the sidebar model reads those two arrays directly
// off the stored snapshot. Merge instead: keep every previously known row,
// let the incoming snapshot's rows win for the ids it actually reports on.
const mergeRowsById = <Row, Key>(
	previousRows: ReadonlyArray<Row>,
	incomingRows: ReadonlyArray<Row>,
	keyOf: (row: Row) => Key,
): ReadonlyArray<Row> => {
	if (incomingRows.length === 0) {
		return previousRows;
	}
	const incomingByKey = new Map(incomingRows.map((row) => [keyOf(row), row]));
	const carriedOver = previousRows.map((row) => incomingByKey.get(keyOf(row)) ?? row);
	const previousKeys = new Set(previousRows.map(keyOf));
	const additions = incomingRows.filter((row) => !previousKeys.has(keyOf(row)));
	return [...carriedOver, ...additions];
};

const mergeLibraryLists = (
	previous: RpcSessionSnapshot,
	incoming: RpcSessionSnapshot,
): RpcSessionSnapshot => {
	// Live-event folding (applyEventToRpcSessionSnapshot) always carries
	// `projects`/`sessions` forward by reference — no event mutates them. That
	// makes this the hot path (one call per streamed token): skip the merge
	// entirely when both arrays are untouched instead of re-scanning them.
	if (incoming.projects === previous.projects && incoming.sessions === previous.sessions) {
		return incoming;
	}
	return {
		...incoming,
		projects: mergeRowsById(
			previous.projects,
			incoming.projects,
			(project: RpcProjectedProject) => project.projectId,
		),
		sessions: mergeRowsById(
			previous.sessions,
			incoming.sessions,
			(session: RpcProjectedSession) => session.sessionId,
		),
	};
};

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
		const merged = mergeLibraryLists(readSnapshot(), snapshot);
		input.registry.set(snapshotAtom, merged);
		if (input.onSnapshot !== undefined) {
			input.onSnapshot(merged);
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
		return readSnapshot();
	});

	// Project scope returns that project's sessions without opening one of them,
	// so the sidebar can list them before a selection is made. The response is
	// scoped to that one project (server-side, on purpose) — replaceSnapshot
	// merges it onto the library-level lists already held, so every other
	// project stays visible in the sidebar.
	const openProject = Effect.fn("openProject")(function* (projectId: ProjectId) {
		const snap = yield* input.client.snapshot({ kind: "project", projectId });
		replaceSnapshot(snap);
		return readSnapshot();
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
		return readSnapshot();
	});

	// Live push from bun to the webview is broken in the Electrobun message
	// transport (pushes leave bun, receiveMessageFromBun never fires), so a
	// send follows up with short polls until the stream settles: stop after
	// three ticks with no sequence progress, cap at 25 ticks.
	const followSession = Effect.fn("followSession")(function* (sessionId: SessionId) {
		let last = -1;
		let quiet = 0;
		let ticks = 0;
		while (quiet < 3 && ticks < 25) {
			yield* Effect.sleep(Duration.millis(400));
			const snap = yield* refreshSession(sessionId);
			quiet = snap.snapshotSequence === last ? quiet + 1 : 0;
			last = snap.snapshotSequence;
			ticks += 1;
		}
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
		followSession,
		dispatch: input.client.dispatch,
		recordSendMoment: (moment: SessionSendMoment) => {
			input.registry.set(sendMomentAtom, moment);
		},
		togglePrLink,
		headerTitle: () => view().headerTitle,
		showWorkingSpark: () => view().showWorkingSpark,
	};
};
