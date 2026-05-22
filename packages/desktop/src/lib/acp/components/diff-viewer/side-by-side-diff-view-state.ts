import type { FileDiff } from "../../types/github-integration.js";
import { parsePatchToBeforeAfter } from "../../utils/diff-patch-parser.js";

export type SideBySideDiffViewMode = "binary" | "deleted" | "added" | "split";

export interface SideBySideDiffViewState {
	mode: SideBySideDiffViewMode;
	before: string;
	after: string;
	language: string | undefined;
}

const languageByExtension: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	svelte: "svelte",
	rs: "rust",
	py: "python",
	go: "go",
	json: "json",
	css: "css",
	scss: "scss",
	html: "html",
	md: "markdown",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	sql: "sql",
};

export function getSideBySideDiffLanguage(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase();
	return languageByExtension[ext ?? ""];
}

export function buildSideBySideDiffViewState(diff: FileDiff): SideBySideDiffViewState {
	const parseResult = parsePatchToBeforeAfter(diff.patch, diff.status);
	const mode = getSideBySideDiffViewMode(diff, parseResult.isErr() ? parseResult.error.type : undefined);

	if (parseResult.isErr()) {
		return {
			mode,
			before: "",
			after: "",
			language: getSideBySideDiffLanguage(diff.path),
		};
	}

	return {
		mode,
		before: parseResult.value.before,
		after: parseResult.value.after,
		language: getSideBySideDiffLanguage(diff.path),
	};
}

function getSideBySideDiffViewMode(diff: FileDiff, errorType: string | undefined): SideBySideDiffViewMode {
	if (errorType === "binary_file") {
		return "binary";
	}

	if (diff.status === "deleted") {
		return "deleted";
	}

	if (diff.status === "added") {
		return "added";
	}

	return "split";
}
