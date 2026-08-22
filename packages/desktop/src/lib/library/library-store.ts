import {
	emptyRpcSessionSnapshot,
	librarySnapshotRequest,
	type OrchestrationEvent,
	type ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

const LIBRARY_EVENT_TYPES = HashSet.fromIterable([
	"ProjectCreated",
	"ProjectMetaUpdated",
	"ProjectDeleted",
	"SessionCreated",
	"SessionMetaUpdated",
	"SessionArchived",
	"SessionUnarchived",
	"SessionDeleted",
	"MessageSent",
]);

export const isLibraryProjectionEvent = (event: OrchestrationEvent): boolean =>
	HashSet.has(LIBRARY_EVENT_TYPES, event.type);

export const composeLibraryStore = (input: {
	readonly client: RpcClient;
	readonly registry: AtomRegistry.AtomRegistry;
	readonly onSnapshot?: (snapshot: RpcSessionSnapshot) => void;
}) => {
	const snapshotAtom = Atom.make<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
	const selectedProjectIdAtom = Atom.make<ProjectId | null>(null);

	const readSnapshot = () => input.registry.get(snapshotAtom);

	const replaceSnapshot = (snapshot: RpcSessionSnapshot) => {
		input.registry.set(snapshotAtom, snapshot);
		if (input.onSnapshot !== undefined) {
			input.onSnapshot(snapshot);
		}
	};

	const refreshLibrary = Effect.fn("refreshLibrary")(function* () {
		const snap = yield* input.client.snapshot(librarySnapshotRequest());
		replaceSnapshot(snap);
		return snap;
	});

	const openLibrary = Effect.fn("openLibrary")(function* () {
		const snap = yield* refreshLibrary();
		yield* input.client.events(snap.snapshotSequence).pipe(
			Stream.runForEach((event) => {
				if (isLibraryProjectionEvent(event) === false) {
					return Effect.void;
				}
				return refreshLibrary().pipe(Effect.asVoid);
			}),
		);
	});

	return {
		snapshotAtom,
		selectedProjectIdAtom,
		openLibrary,
		// Selecting a project must also load its sessions. Setting the id alone
		// leaves the sidebar showing the previous project's sessions.
		selectProject: (projectId: ProjectId) => {
			input.registry.set(selectedProjectIdAtom, projectId);
		},
		openProject: Effect.fn("openProject")(function* (projectId: ProjectId) {
			input.registry.set(selectedProjectIdAtom, projectId);
			const snap = yield* input.client.snapshot({ kind: "project", projectId });
			input.registry.set(snapshotAtom, snap);
			return snap;
		}),
		readSnapshot,
	};
};
