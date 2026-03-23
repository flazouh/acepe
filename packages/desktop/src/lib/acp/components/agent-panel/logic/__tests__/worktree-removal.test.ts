import { describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";

import { removeWorktreeAndMarkSessionWorktreeDeleted } from "../worktree-removal.js";

describe("removeWorktreeAndMarkSessionWorktreeDeleted", () => {
	it("marks the session worktree as deleted after a successful worktree removal", async () => {
		const removeWorktree = mock(() => okAsync(undefined));
		const markSessionWorktreeDeleted = mock(() => undefined);
		const clearSessionWorktreeDeleted = mock(() => undefined);
		const disconnectSession = mock(() => undefined);

		const result = await removeWorktreeAndMarkSessionWorktreeDeleted(
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
		);

		expect(result.isOk()).toBe(true);
		expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(removeWorktree).toHaveBeenCalledWith("/repo/.worktrees/feature-a", true);
		expect(clearSessionWorktreeDeleted).not.toHaveBeenCalled();
		expect(disconnectSession).toHaveBeenCalledWith("session-123");
	});

	it("does not mark session state when worktree removal fails", async () => {
		const removeWorktree = mock(() => errAsync(new Error("remove failed")));
		const markSessionWorktreeDeleted = mock(() => undefined);
		const clearSessionWorktreeDeleted = mock(() => undefined);
		const disconnectSession = mock(() => undefined);

		const result = await removeWorktreeAndMarkSessionWorktreeDeleted(
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
		);

		expect(result.isErr()).toBe(true);
		expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(clearSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(disconnectSession).not.toHaveBeenCalled();
	});

	it("disconnects the session even when there is no follow-up persistence step", async () => {
		const removeWorktree = mock(() => okAsync(undefined));
		const markSessionWorktreeDeleted = mock(() => undefined);
		const clearSessionWorktreeDeleted = mock(() => undefined);
		const disconnectSession = mock(() => undefined);

		const result = await removeWorktreeAndMarkSessionWorktreeDeleted(
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
		);

		expect(result.isOk()).toBe(true);
		expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
		expect(clearSessionWorktreeDeleted).not.toHaveBeenCalled();
		expect(disconnectSession).toHaveBeenCalledWith("session-123");
	});
});
