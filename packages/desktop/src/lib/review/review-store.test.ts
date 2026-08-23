import { CommandId, emptyRpcSessionSnapshot, EventId, ProjectId } from "@acepe/contracts";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { composeReviewStore, isGitReviewEvent } from "./review-store.ts";

describe("isGitReviewEvent", () => {
	it("accepts only git review events", () => {
		expect(
			isGitReviewEvent({
				sequence: 1,
				eventId: EventId.make("event-1"),
				aggregateKind: "git",
				aggregateId: ProjectId.make("project-1"),
				occurredAt: "2026-08-20T12:00:00.000Z",
				commandId: CommandId.make("cmd-1"),
				causationEventId: null,
				correlationId: CommandId.make("cmd-1"),
				metadata: {},
				type: "GitStatusRefreshed",
				payload: {
					projectId: ProjectId.make("project-1"),
					status: null,
				},
			}),
		).toBe(true);
		expect(
			isGitReviewEvent({
				sequence: 1,
				eventId: EventId.make("event-1"),
				aggregateKind: "project",
				aggregateId: ProjectId.make("project-1"),
				occurredAt: "2026-08-20T12:00:00.000Z",
				commandId: CommandId.make("cmd-1"),
				causationEventId: null,
				correlationId: CommandId.make("cmd-1"),
				metadata: {},
				type: "ProjectCreated",
				payload: {
					projectId: ProjectId.make("project-1"),
					title: "Acepe",
					workspaceRoot: "/tmp/acepe",
				},
			}),
		).toBe(false);
	});
});

describe("composeReviewStore", () => {
	it("dispatches status refresh then loads the git snapshot", () => {
		const dispatched: Array<string> = [];
		const registry = AtomRegistry.make();
		let latest = emptyRpcSessionSnapshot(0);
		const store = composeReviewStore({
			client: {
				dispatch: (command) => {
					dispatched.push(command.type);
					return Effect.succeed({ sequence: 1 });
				},
				snapshot: () =>
					Effect.succeed({
						snapshotSequence: 1,
						session: null,
						messages: [],
						turns: [],
						activities: [],
						pendingApprovals: [],
						checkpoints: [],
						projects: [],
						sessions: [],
						settings: [],
						skillsCatalog: null,
						voice: null,
						gitReview: {
							sequence: 1,
							projectId: ProjectId.make("project-1"),
							status: [],
							files: [],
						},
					}),
				events: () => Stream.empty,
				getProjectIndex: () =>
					Effect.succeed({
						projectPath: "/tmp/acepe",
						files: [],
						gitStatus: [],
						totalFiles: 0,
						totalLines: 0,
					}),
				invalidateProjectIndex: () => Effect.void,
			},
			registry,
			onSnapshot: (snapshot) => {
				latest = snapshot;
			},
		});
		const program = store.openReview({
			projectId: ProjectId.make("project-1"),
			workspaceRoot: "/tmp/acepe",
		});
		const result = Effect.runSync(program);
		expect(dispatched[0]).toBe("git.status.refresh");
		expect(result.gitReview?.status).toEqual([]);
		expect(latest.gitReview?.status).toEqual([]);
	});

	it("loads the first dirty file after status refresh", () => {
		const dispatched: Array<string> = [];
		const registry = AtomRegistry.make();
		const store = composeReviewStore({
			client: {
				dispatch: (command) => {
					dispatched.push(command.type);
					return Effect.succeed({ sequence: 1 });
				},
				snapshot: () =>
					Effect.succeed({
						snapshotSequence: 1,
						session: null,
						messages: [],
						turns: [],
						activities: [],
						pendingApprovals: [],
						checkpoints: [],
						projects: [],
						sessions: [],
						settings: [],
						skillsCatalog: null,
						voice: null,
						gitReview: {
							sequence: 1,
							projectId: ProjectId.make("project-1"),
							status: [
								{
									path: "notes.md",
									status: "M",
									insertions: 1,
									deletions: 1,
								},
							],
							files: [],
						},
					}),
				events: () => Stream.empty,
				getProjectIndex: () =>
					Effect.succeed({
						projectPath: "/tmp/acepe",
						files: [],
						gitStatus: [],
						totalFiles: 0,
						totalLines: 0,
					}),
				invalidateProjectIndex: () => Effect.void,
			},
			registry,
		});
		Effect.runSync(
			store.openReview({
				projectId: ProjectId.make("project-1"),
				workspaceRoot: "/tmp/acepe",
			}),
		);
		expect(dispatched).toEqual([
			"git.status.refresh",
			"git.diff.load",
			"git.blame.load",
		]);
		expect(store.readSelectedPath()).toBe("notes.md");
	});

	it("skips diff load when the seeded snapshot already has the file", () => {
		const dispatched: Array<string> = [];
		const registry = AtomRegistry.make();
		const store = composeReviewStore({
			client: {
				dispatch: (command) => {
					dispatched.push(command.type);
					return Effect.succeed({ sequence: 1 });
				},
				snapshot: () =>
					Effect.succeed({
						snapshotSequence: 2,
						session: null,
						messages: [],
						turns: [],
						activities: [],
						pendingApprovals: [],
						checkpoints: [],
						projects: [],
						sessions: [],
						settings: [],
						skillsCatalog: null,
						voice: null,
						gitReview: {
							sequence: 2,
							projectId: ProjectId.make("project-1"),
							status: [
								{
									path: "notes.md",
									status: "M",
									insertions: 2,
									deletions: 2,
								},
							],
							files: [
								{
									path: "notes.md",
									diff: {
										oldContent: "alpha\n",
										newContent: "BRAVO\n",
										fileName: "notes.md",
									},
									patch: "@@ -1,1 +1,1 @@\n-alpha\n+BRAVO\n",
									blame: [],
									hunkDecisions: [],
								},
							],
						},
					}),
				events: () => Stream.empty,
				getProjectIndex: () =>
					Effect.succeed({
						projectPath: "/tmp/acepe",
						files: [],
						gitStatus: [],
						totalFiles: 0,
						totalLines: 0,
					}),
				invalidateProjectIndex: () => Effect.void,
			},
			registry,
		});
		Effect.runSync(
			store.openReview({
				projectId: ProjectId.make("project-1"),
				workspaceRoot: "/tmp/acepe",
			}),
		);
		expect(dispatched).toEqual(["git.status.refresh"]);
		expect(store.readSelectedPath()).toBe("notes.md");
	});
});
