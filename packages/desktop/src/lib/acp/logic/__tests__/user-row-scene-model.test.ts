import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../../../services/acp-types.js";
import { buildUserRowSceneModel, mergeAdjacentUserCommandChunks } from "../user-row-scene-model.js";

function userEntry(segments: TranscriptEntry["segments"]): TranscriptEntry {
	return {
		entryId: "user-1",
		role: "user",
		segments,
	};
}

describe("buildUserRowSceneModel", () => {
	it("projects local command segments into command chunks", () => {
		const row = buildUserRowSceneModel(
			userEntry([
				{
					kind: "localCommand",
					segmentId: "seg-1",
					command: "/login",
					message: "login",
					args: "",
					stdout: "Login successful",
				},
			])
		);

		expect(row.chunks).toHaveLength(1);
		expect(row.chunks[0]?.kind).toBe("localCommand");
		if (row.chunks[0]?.kind === "localCommand") {
			expect(row.chunks[0].command).toBe("/login");
			expect(row.chunks[0].chip.cleanStdout).toBe("Login successful");
		}
		expect(row.text).toBe("Login successful");
	});

	it("keeps plain text segments as text chunks", () => {
		const row = buildUserRowSceneModel(
			userEntry([
				{
					kind: "text",
					segmentId: "seg-1",
					text: "hello",
				},
			])
		);

		expect(row.chunks).toEqual([{ kind: "text", text: "hello" }]);
	});

	it("projects canonical pasted content back to a pasted-text chip token", () => {
		const row = buildUserRowSceneModel(
			userEntry([
				{
					kind: "text",
					segmentId: "seg-1",
					text: "Please inspect this",
				},
				{
					kind: "pastedContent",
					segmentId: "seg-2",
					text: "first pasted line\nsecond pasted line",
				},
			])
		);

		expect(row.chunks).toEqual([
			{ kind: "text", text: "Please inspect this" },
			{
				kind: "text",
				text: "@[text:Zmlyc3QgcGFzdGVkIGxpbmUKc2Vjb25kIHBhc3RlZCBsaW5l]",
			},
		]);
	});
});

describe("mergeAdjacentUserCommandChunks", () => {
	it("merges header-only and stdout-only command chunks", () => {
		const left = buildUserRowSceneModel(
			userEntry([
				{
					kind: "localCommand",
					segmentId: "seg-1",
					command: "/login",
					message: "login",
					args: "",
					stdout: "",
				},
			])
		).chunks;
		const right = buildUserRowSceneModel(
			userEntry([
				{
					kind: "localCommand",
					segmentId: "seg-2",
					command: "",
					message: "",
					args: "",
					stdout: "Login successful",
				},
			])
		).chunks;

		const merged = mergeAdjacentUserCommandChunks(left, right);
		expect(merged).not.toBeNull();
		expect(merged?.[0]?.kind).toBe("localCommand");
		if (merged?.[0]?.kind === "localCommand") {
			expect(merged[0].command).toBe("/login");
			expect(merged[0].stdout).toBe("Login successful");
		}
	});
});
