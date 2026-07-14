import type { HugeiconsIconName } from "@acepe/ui/icons";

import type { PaletteMode } from "../../types/palette-mode.js";

export type PaletteTabIconModel = {
	readonly name: HugeiconsIconName;
};

export function resolvePaletteTabIcon(mode: PaletteMode): PaletteTabIconModel {
	if (mode === "commands") {
		return {
			name: "terminal",
		};
	}

	if (mode === "sessions") {
		return {
			name: "chat",
		};
	}

	return {
		name: "files",
	};
}
