import {
	CommandId,
	emptyComposerMcpCatalog,
	emptyRpcSessionSnapshot,
	emptySkillsCatalog,
	McpCatalogResolveCommand,
	PreconnectionOptionsLoadCommand,
	ProjectId,
	mcpSnapshotRequest,
	type OrchestrationEvent,
	type RpcClient,
	type RpcSessionSnapshot,
	SkillsDiscoverCommand,
	skillsSnapshotRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import {
	LIBRARY_SETUP_PROJECT_ID,
	LIBRARY_SETUP_PROJECT_ROOT,
	LIBRARY_SETUP_PROVIDER_ID,
	mergeSetupBarSnapshots,
} from "./setup-bar-state.ts";

const SETUP_BAR_EVENT_TYPES = HashSet.fromIterable([
	"SkillsDiscovered",
	"McpCatalogResolved",
	"PreconnectionOptionsLoaded",
]);

export const isSetupBarEvent = (event: OrchestrationEvent): boolean =>
	HashSet.has(SETUP_BAR_EVENT_TYPES, event.type);

export const composeSetupBarStore = (input: {
	readonly client: RpcClient;
	readonly registry: AtomRegistry.AtomRegistry;
	readonly onSnapshot?: (snapshot: RpcSessionSnapshot) => void;
}) => {
	let commandSeq = 0;
	const snapshotAtom = Atom.make<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));

	const nextCommandId = () => {
		commandSeq += 1;
		return CommandId.make(`setup-bar-${String(commandSeq)}-${crypto.randomUUID()}`);
	};

	const replaceSnapshot = (snapshot: RpcSessionSnapshot) => {
		input.registry.set(snapshotAtom, snapshot);
		if (input.onSnapshot !== undefined) {
			input.onSnapshot(snapshot);
		}
	};

	const refresh = Effect.fn("refreshSetupBar")(function* () {
		const projectId = ProjectId.make(LIBRARY_SETUP_PROJECT_ID);
		const skillsSnap = yield* input.client.snapshot(skillsSnapshotRequest());
		const mcpSnap = yield* input.client.snapshot(mcpSnapshotRequest(projectId));
		const merged = mergeSetupBarSnapshots(skillsSnap, mcpSnap);
		replaceSnapshot(merged);
		return merged;
	});

	const openSetupBar = Effect.fn("openSetupBar")(function* () {
		const projectId = ProjectId.make(LIBRARY_SETUP_PROJECT_ID);
		yield* input.client.dispatch(
			SkillsDiscoverCommand.make({
				type: "skills.discover",
				commandId: nextCommandId(),
				catalog: emptySkillsCatalog,
			}),
		);
		yield* input.client.dispatch(
			McpCatalogResolveCommand.make({
				type: "mcp.catalog.resolve",
				commandId: nextCommandId(),
				projectId,
				projectRoot: LIBRARY_SETUP_PROJECT_ROOT,
				catalog: emptyComposerMcpCatalog,
			}),
		);
		yield* input.client.dispatch(
			PreconnectionOptionsLoadCommand.make({
				type: "preconnection.options.load",
				commandId: nextCommandId(),
				projectId,
				providerId: LIBRARY_SETUP_PROVIDER_ID,
				options: [],
			}),
		);
		return yield* refresh();
	});

	const watchSetupBar = Effect.fn("watchSetupBar")(function* () {
		const current = input.registry.get(snapshotAtom);
		yield* input.client.events(current.snapshotSequence).pipe(
			Stream.runForEach((event) => {
				if (isSetupBarEvent(event) === false) {
					return Effect.void;
				}
				return refresh().pipe(Effect.asVoid);
			}),
		);
	});

	return {
		snapshotAtom,
		openSetupBar,
		watchSetupBar,
		readSnapshot: () => input.registry.get(snapshotAtom),
	};
};
