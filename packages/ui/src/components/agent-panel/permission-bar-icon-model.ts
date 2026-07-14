import type { HugeiconsIconName } from "../icons/index.js";

type PermissionBarIconModelEntry = {
	readonly name: HugeiconsIconName;
	readonly testId: string;
	readonly sizeOffset: 0 | -1;
};

export type PermissionBarIconModel = PermissionBarIconModelEntry;

export function getPermissionBarIconModel(kind: string): PermissionBarIconModel {
	if (kind === "edit") {
		return {
			name: "edit",
			testId: "permission-bar-edit-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "read" || kind === "read_lints") {
		return {
			name: "file-text",
			testId: "permission-bar-read-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "execute") {
		return {
			name: "terminal",
			testId: "permission-bar-execute-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "search") {
		return {
			name: "search",
			testId: "permission-bar-search-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "fetch" || kind === "web_search") {
		return {
			name: "globe",
			testId: "permission-bar-fetch-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "delete") {
		return {
			name: "trash",
			testId: "permission-bar-delete-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "move") {
		return {
			name: "arrow-right",
			testId: "permission-bar-move-icon",
			sizeOffset: 0,
		};
	}
	if (kind === "browser") {
		return {
			name: "app-window",
			testId: "permission-bar-browser-icon",
			sizeOffset: 0,
		};
	}
	return {
		name: "shield-warning",
		testId: "permission-bar-shield-warning-icon",
		sizeOffset: -1,
	};
}
