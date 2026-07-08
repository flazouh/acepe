import { describe, expect, it } from "bun:test";
import { buildSessionTranscriptFileDialogTarget } from "./session-transcript-file-dialog.js";

describe("buildSessionTranscriptFileDialogTarget", () => {
	it("splits a normal absolute path into parent directory and file name", () => {
		expect(
			buildSessionTranscriptFileDialogTarget("/Users/alex/.codex/sessions/thread.jsonl")
		).toEqual({
			projectPath: "/Users/alex/.codex/sessions",
			filePath: "thread.jsonl",
			projectName: "sessions",
		});
	});

	it("keeps root as the parent directory", () => {
		expect(buildSessionTranscriptFileDialogTarget("/thread.jsonl")).toEqual({
			projectPath: "/",
			filePath: "thread.jsonl",
			projectName: "/",
		});
	});

	it("normalizes Windows-style separators", () => {
		expect(
			buildSessionTranscriptFileDialogTarget("C:\\Users\\alex\\sessions\\thread.jsonl")
		).toEqual({
			projectPath: "C:/Users/alex/sessions",
			filePath: "thread.jsonl",
			projectName: "sessions",
		});
	});

	it("rejects blank paths and paths without a parent directory", () => {
		expect(buildSessionTranscriptFileDialogTarget("")).toBeNull();
		expect(buildSessionTranscriptFileDialogTarget("thread.jsonl")).toBeNull();
		expect(buildSessionTranscriptFileDialogTarget("/Users/alex/sessions/")).toBeNull();
	});
});
