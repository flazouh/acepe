import {
	CommandId,
	emptyGitFileDiff,
	emptyRpcSessionSnapshot,
	GitBlameLoadCommand,
	GitDiffLoadCommand,
	GitHunkAcceptCommand,
	GitHunkRejectCommand,
	gitSnapshotRequest,
	GitStatusRefreshCommand,
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

import { gitReviewFileIsReady } from "./review-state.ts";

const GIT_EVENT_TYPES = HashSet.fromIterable([
	"GitStatusRefreshed",
	"GitDiffLoaded",
	"GitBlameLoaded",
	"GitHunkAccepted",
	"GitHunkRejected",
]);

export const isGitReviewEvent = (event: OrchestrationEvent): boolean =>
	HashSet.has(GIT_EVENT_TYPES, event.type);

export const composeReviewStore = (input: {
	readonly client: RpcClient;
	readonly registry: AtomRegistry.AtomRegistry;
	readonly onSnapshot?: (snapshot: RpcSessionSnapshot) => void;
}) => {
	let commandSeq = 0;
	const snapshotAtom = Atom.make<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
	const selectedPathAtom = Atom.make<string | null>(null);

	const nextCommandId = () => {
		commandSeq += 1;
		return CommandId.make(`git-review-${String(commandSeq)}-${crypto.randomUUID()}`);
	};

	const replaceSnapshot = (snapshot: RpcSessionSnapshot) => {
		input.registry.set(snapshotAtom, snapshot);
		if (input.onSnapshot !== undefined) {
			input.onSnapshot(snapshot);
		}
	};

	const refresh = Effect.fn("refreshGitReview")(function* (projectId: ProjectId) {
		const snap = yield* input.client.snapshot(gitSnapshotRequest(projectId));
		replaceSnapshot(snap);
		return snap;
	});

	const dispatchStatus = Effect.fn("dispatchGitStatus")(function* (inputArgs: {
		readonly projectId: ProjectId;
		readonly workspaceRoot: string;
	}) {
		yield* input.client.dispatch(
			GitStatusRefreshCommand.make({
				type: "git.status.refresh",
				commandId: nextCommandId(),
				projectId: inputArgs.projectId,
				workspaceRoot: inputArgs.workspaceRoot,
				status: null,
			}),
		);
	});

	const dispatchDiff = Effect.fn("dispatchGitDiff")(function* (inputArgs: {
		readonly projectId: ProjectId;
		readonly workspaceRoot: string;
		readonly filePath: string;
	}) {
		yield* input.client.dispatch(
			GitDiffLoadCommand.make({
				type: "git.diff.load",
				commandId: nextCommandId(),
				projectId: inputArgs.projectId,
				workspaceRoot: inputArgs.workspaceRoot,
				filePath: inputArgs.filePath,
				diff: emptyGitFileDiff,
				patch: "",
			}),
		);
	});

	const dispatchBlame = Effect.fn("dispatchGitBlame")(function* (inputArgs: {
		readonly projectId: ProjectId;
		readonly workspaceRoot: string;
		readonly filePath: string;
	}) {
		yield* input.client.dispatch(
			GitBlameLoadCommand.make({
				type: "git.blame.load",
				commandId: nextCommandId(),
				projectId: inputArgs.projectId,
				workspaceRoot: inputArgs.workspaceRoot,
				filePath: inputArgs.filePath,
				blame: [],
			}),
		);
	});

	const loadFile = Effect.fn("loadGitReviewFile")(function* (inputArgs: {
		readonly projectId: ProjectId;
		readonly workspaceRoot: string;
		readonly filePath: string;
	}) {
		input.registry.set(selectedPathAtom, inputArgs.filePath);
		yield* dispatchDiff({
			projectId: inputArgs.projectId,
			workspaceRoot: inputArgs.workspaceRoot,
			filePath: inputArgs.filePath,
		});
		yield* dispatchBlame({
			projectId: inputArgs.projectId,
			workspaceRoot: inputArgs.workspaceRoot,
			filePath: inputArgs.filePath,
		});
		return yield* refresh(inputArgs.projectId);
	});

	const openReview = Effect.fn("openGitReview")(function* (inputArgs: {
		readonly projectId: ProjectId;
		readonly workspaceRoot: string;
	}) {
		const seeded = yield* refresh(inputArgs.projectId);
		const seededPath = seeded.gitReview?.status?.[0]?.path;
		if (seededPath !== undefined) {
			input.registry.set(selectedPathAtom, seededPath);
		}
		yield* dispatchStatus(inputArgs);
		const snap = yield* refresh(inputArgs.projectId);
		const firstPath = snap.gitReview?.status?.[0]?.path ?? seededPath;
		if (firstPath === undefined) {
			return snap;
		}
		input.registry.set(selectedPathAtom, firstPath);
		if (gitReviewFileIsReady(snap.gitReview, firstPath) === true) {
			return snap;
		}
		return yield* loadFile({
			projectId: inputArgs.projectId,
			workspaceRoot: inputArgs.workspaceRoot,
			filePath: firstPath,
		});
	});

	const watchReview = Effect.fn("watchGitReview")(function* (projectId: ProjectId) {
		const current = input.registry.get(snapshotAtom);
		yield* input.client.events(current.snapshotSequence).pipe(
			Stream.runForEach((event) => {
				if (isGitReviewEvent(event) === false) {
					return Effect.void;
				}
				return refresh(projectId).pipe(Effect.asVoid);
			}),
		);
	});

	return {
		snapshotAtom,
		selectedPathAtom,
		openReview,
		watchReview,
		loadFile,
		acceptHunk: Effect.fn("acceptGitHunk")(function* (inputArgs: {
			readonly projectId: ProjectId;
			readonly workspaceRoot: string;
			readonly filePath: string;
			readonly hunkIndex: number;
		}) {
			yield* input.client.dispatch(
				GitHunkAcceptCommand.make({
					type: "git.hunk.accept",
					commandId: nextCommandId(),
					projectId: inputArgs.projectId,
					workspaceRoot: inputArgs.workspaceRoot,
					filePath: inputArgs.filePath,
					hunkIndex: inputArgs.hunkIndex,
				}),
			);
			return yield* refresh(inputArgs.projectId);
		}),
		rejectHunk: Effect.fn("rejectGitHunk")(function* (inputArgs: {
			readonly projectId: ProjectId;
			readonly workspaceRoot: string;
			readonly filePath: string;
			readonly hunkIndex: number;
		}) {
			yield* input.client.dispatch(
				GitHunkRejectCommand.make({
					type: "git.hunk.reject",
					commandId: nextCommandId(),
					projectId: inputArgs.projectId,
					workspaceRoot: inputArgs.workspaceRoot,
					filePath: inputArgs.filePath,
					hunkIndex: inputArgs.hunkIndex,
					newContent: "",
				}),
			);
			return yield* refresh(inputArgs.projectId);
		}),
		readSnapshot: () => input.registry.get(snapshotAtom),
		readSelectedPath: () => input.registry.get(selectedPathAtom),
	};
};
