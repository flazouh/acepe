import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { sessionReviewState } from "./session-review-state.ts";

const sessionId = SessionId.make("session-1");

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const withReviewState = (
	snapshot: RpcSessionSnapshot,
	sessionReview: RpcSessionSnapshot["sessionReviewState"]
): RpcSessionSnapshot => ({
	...snapshot,
	sessionReviewState: sessionReview,
});

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () => Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("sessionReviewState rpc facade", () => {
	it("returns null when the snapshot carries no review state", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* sessionReviewState.get("session-1");
				expect(result).toBeNull();
			})
		));

	it("returns null when the snapshot's review state has no tracked files", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withReviewState(emptyRpcSessionSnapshot(0), {
									sequence: 1,
									sessionId,
									files: [],
								})
							),
					})
				);
				const result = yield* sessionReviewState.get("session-1");
				expect(result).toBeNull();
			})
		));

	it("reconstructs the version-2 JSON blob from the snapshot's tracked files", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withReviewState(emptyRpcSessionSnapshot(0), {
									sequence: 2,
									sessionId,
									files: [
										{ revisionKey: "src/a.ts:hash1", filePath: "src/a.ts", reviewed: true },
										{ revisionKey: "src/b.ts:hash2", filePath: "src/b.ts", reviewed: false },
									],
								})
							),
					})
				);
				const result = yield* sessionReviewState.get("session-1");
				expect(result).not.toBeNull();
				expect(JSON.parse(result ?? "")).toEqual({
					version: 2,
					filesByRevisionKey: {
						"src/a.ts:hash1": { filePath: "src/a.ts", reviewed: true },
						"src/b.ts:hash2": { filePath: "src/b.ts", reviewed: false },
					},
				});
			})
		));

	it("save clears the session then marks every file in the blob reviewed", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const stateJson = JSON.stringify({
					version: 2,
					filesByRevisionKey: {
						"src/a.ts:hash1": { filePath: "src/a.ts", reviewed: true },
					},
				});
				yield* sessionReviewState.save("session-1", stateJson);
				expect(dispatched.map((command) => command.type)).toEqual([
					"review.session.clear",
					"review.file.markReviewed",
				]);
				expect(dispatched[1]).toMatchObject({
					type: "review.file.markReviewed",
					sessionId: "session-1",
					revisionKey: "src/a.ts:hash1",
					filePath: "src/a.ts",
					reviewed: true,
				});
			})
		));

	it("save with an empty blob only clears the session", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* sessionReviewState.save(
					"session-1",
					JSON.stringify({ version: 2, filesByRevisionKey: {} })
				);
				expect(dispatched.map((command) => command.type)).toEqual(["review.session.clear"]);
			})
		));

	it("delete dispatches review.session.clear", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* sessionReviewState.delete("session-1");
				expect(dispatched.map((command) => command.type)).toEqual(["review.session.clear"]);
			})
		));
});
