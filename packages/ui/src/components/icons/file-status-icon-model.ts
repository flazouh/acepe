import type { HugeiconsIconName } from "./hugeicons-icon-registry.js";
import type { FileStatusIconKind } from "./file-status-icon-types.js";

export type FileStatusIconModel = {
	readonly name: HugeiconsIconName;
};

export function getFileStatusIconModel(status: FileStatusIconKind): FileStatusIconModel {
	if (status === "deleted") {
		return {
			name: "trash",
		};
	}
	if (status === "renamed") {
		return {
			name: "edit",
		};
	}
	return {
		name: "add",
	};
}
