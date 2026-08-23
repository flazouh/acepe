import { describe, expect, it } from "bun:test";
import { emptyRpcSessionSnapshot, ProjectId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { reviewModalViewModel } from "../../review/review-state.ts";
import { composeReviewStore } from "../../review/review-store.ts";

const projectId = ProjectId.make("git-review-project-1");

describe("review modal controller mapping", () => {
	it("maps a git snapshot onto pierre file contents and pending hunks", () => {
		const registry = AtomRegistry.make();
		const store = composeReviewStore({
			client: {
				dispatch: () => Effect.succeed({ sequence: 2 }),
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
							projectId,
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
										oldContent: "alpha\nbravo\n",
										newContent: "alpha\nBRAVO\n",
										fileName: "notes.md",
									},
									patch: "@@ -1,2 +1,2 @@\n alpha\n-bravo\n+BRAVO\n",
									blame: [
										{
											line: 1,
											commit: "abc1234",
											author: "Test User",
											summary: "Seed notes",
										},
									],
									hunkDecisions: [],
								},
							],
						},
					}),
				events: () => Stream.empty,
				getProjectIndex: () =>
					Effect.succeed({
						projectPath: "/tmp/acepe-git-review-242",
						files: [],
						gitStatus: [],
						totalFiles: 0,
						totalLines: 0,
					}),
				invalidateProjectIndex: () => Effect.void,
			},
			registry,
		});
		const snap = Effect.runSync(
			store.openReview({
				projectId,
				workspaceRoot: "/tmp/acepe-git-review-242",
			}),
		);
		const model = reviewModalViewModel({
			gitReview: snap.gitReview,
			selectedPath: store.readSelectedPath(),
		});
		expect(emptyRpcSessionSnapshot(0).gitReview).toBeNull();
		expect(model.status?.[0]?.path).toBe("notes.md");
		expect(model.files[0]?.fileName).toBe("notes.md");
		expect(model.files[0]?.oldContent).toBe("alpha\nbravo\n");
		expect(model.files[0]?.newContent).toBe("alpha\nBRAVO\n");
		expect(model.files[0]?.hunks).toEqual([{ index: 0, action: null }]);
		expect(model.files[0]?.blame[0]?.author).toBe("Test User");
	});
});
