import { describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	librarySnapshotRequest,
	ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { librarySidebarViewModel } from "../../library/library-state.ts";
import { composeLibraryStore } from "../../library/library-store.ts";

const projectId = ProjectId.make("library-project-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

const snapshot: RpcSessionSnapshot = {
	snapshotSequence: 8,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	projects: [
		{
			projectId,
			title: "Acepe",
			workspaceRoot: "/tmp/acepe",
			createdAt: occurredAt,
			updatedAt: occurredAt,
			deletedAt: null,
			sessionCount: 2,
		},
	],
	sessions: [
		{
			sessionId: SessionId.make("library-session-fallback"),
			projectId,
			title: "Fix the auth bug",
			provider: null,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			lastActivityAt: occurredAt,
			archivedAt: null,
			deletedAt: null,
			prNumber: null,
			prLinkMode: null,
		},
		{
			sessionId: SessionId.make("library-session-archived"),
			projectId,
			title: "Archived thread",
			provider: null,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			lastActivityAt: occurredAt,
			archivedAt: occurredAt,
			deletedAt: null,
			prNumber: null,
			prLinkMode: null,
		},
	],
};

describe("library sidebar controller mapping", () => {
	it("maps a library snapshot onto sidebar props after openLibrary", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requested: Array<unknown> = [];
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 1 }),
					snapshot: (request) => {
						requested.push(request);
						return Effect.succeed(snapshot);
					},
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const registry = AtomRegistry.make();
				const store = composeLibraryStore({ client, registry });
				yield* store.openLibrary();
				store.selectProject(projectId);
				const model = librarySidebarViewModel({
					snapshot: registry.get(store.snapshotAtom),
					selectedProjectId: registry.get(store.selectedProjectIdAtom),
				});
				expect(requested).toEqual([librarySnapshotRequest()]);
				expect(model.projects[0]?.title).toBe("Acepe");
				expect(model.sessions.map((row) => row.title)).toEqual([
					"Fix the auth bug",
					"Archived thread",
				]);
				expect(model.sessions[1]?.lifecycle).toBe("archived");
				expect(emptyRpcSessionSnapshot(0).projects).toEqual([]);
			}),
		));
});
