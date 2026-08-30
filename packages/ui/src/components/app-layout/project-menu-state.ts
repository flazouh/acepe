import { COLOR_NAMES, Colors } from "../../lib/colors.js";

import type { ProjectColorOption } from "./project-color-options.js";

export interface ProjectHeaderOverflowMenuState {
	readonly selectedColorHex: string;
	readonly showColorPicker: boolean;
}

export function getSelectedProjectColorHex(input: {
	readonly currentColor: string | undefined;
	readonly colorOptions: readonly ProjectColorOption[];
}): string {
	const selectedOption = input.colorOptions.find(
		(option) => input.currentColor === option.name || input.currentColor === option.hex
	);
	return selectedOption?.hex ?? input.colorOptions[0]?.hex ?? Colors[COLOR_NAMES.RED];
}

// The color picker used to hide behind a project icon. Nothing can set an icon
// any more -- a project icon has no home on the server, so the menu items that
// picked and cleared one are gone -- so the picker only depends on whether the
// caller offers a color action.
export function buildProjectHeaderOverflowMenuState(input: {
	readonly currentColor: string | undefined;
	readonly colorOptions: readonly ProjectColorOption[];
	readonly hasColorChange: boolean;
}): ProjectHeaderOverflowMenuState {
	return {
		selectedColorHex: getSelectedProjectColorHex({
			currentColor: input.currentColor,
			colorOptions: input.colorOptions,
		}),
		showColorPicker: input.hasColorChange,
	};
}
