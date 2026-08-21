import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { removeWorktreeAndMarkSessionWorktreeDeleted } from "../worktree-removal.js";

describe("removeWorktreeAndMarkSessionWorktreeDeleted", () => {
	it("marks the session worktree as deleted after a successful worktree removal", async () => {
		const removeWorktree = mock(() => Effect.succeed(undefined));
		const markSessionWorktreeDeleted = mock(() => undefined);
		const clearSessionWorktreeDeleted = mock(() => undefined);
		const disconnectSession = mock(() => undefined);

		const result = await Effect.runPromise(
			Effect.result(
				removeWorktreeAndMarkSessionWorktreeDeleted(
					{
						force: true,
						sessionId: "session-123",
						worktreePath: "/repo/.worktrees/feature-a",
					},
					{
						removeWorktree,
						markSessionWorktreeDeleted,
						clearSessionWorktreeDeleted,
						disconnectSession,
					}
				)
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(removeWorktree).toHaveBeenCalledWith("/repo/.worktrees/feature-a", true);
		expect(clearSessionWorktreeDeleted).not.toHaveBeenCalled();
		expect(disconnectSession).toHaveBeenCalledWith("session-123");
	});

	it("does not mark session state when worktree removal fails", async () => {
		const removeWorktree = mock(() => Effect.fail(new Error("remove failed")));
		const markSessionWorktreeDeleted = mock(() => undefined);
		const clearSessionWorktreeDeleted = mock(() => undefined);
		const disconnectSession = mock(() => undefined);

		const result = await Effect.runPromise(
			Effect.result(
				removeWorktreeAndMarkSessionWorktreeDeleted(
					{
						force: false,
						sessionId: "session-123",
						worktreePath: "/repo/.worktrees/feature-a",
					},
					{
						removeWorktree,
						markSessionWorktreeDeleted,
						clearSessionWorktreeDeleted,
						disconnectSession,
					}
				)
			)
		);

		expect(Result.isFailure(result)).toBe(true);
		expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(clearSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(disconnectSession).not.toHaveBeenCalled();
	});

	it("disconnects the session even when there is no follow-up persistence step", async () => {
		const removeWorktree = mock(() => Effect.succeed(undefined));
		const markSessionWorktreeDeleted = mock(() => undefined);
		const clearSessionWorktreeDeleted = mock(() => undefined);
		const disconnectSession = mock(() => undefined);

		const result = await Effect.runPromise(
			Effect.result(
				removeWorktreeAndMarkSessionWorktreeDeleted(
					{
						force: false,
						sessionId: "session-123",
						worktreePath: "/repo/.worktrees/feature-a",
					},
					{
						removeWorktree,
						markSessionWorktreeDeleted,
						clearSessionWorktreeDeleted,
						disconnectSession,
					}
				)
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(clearSessionWorktreeDeleted).not.toHaveBeenCalled();
		expect(disconnectSession).toHaveBeenCalledWith("session-123");
	});
});
