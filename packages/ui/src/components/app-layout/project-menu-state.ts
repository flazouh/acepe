import { COLOR_NAMES, Colors } from "../../lib/colors.js";

import type { ProjectColorOption } from "./project-color-options.js";

export interface ProjectHeaderOverflowMenuState {
	readonly selectedColorHex: string;
	readonly hasIcon: boolean;
	readonly hasResetProjectIcon: boolean;
	readonly showColorPicker: boolean;
	readonly showSettingsSection: boolean;
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

export function buildProjectHeaderOverflowMenuState(input: {
	readonly currentColor: string | undefined;
	readonly colorOptions: readonly ProjectColorOption[];
	readonly projectIconSrc: string | null;
	readonly hasColorChange: boolean;
	readonly hasResetProjectIconAction: boolean;
	readonly hasRemoveProjectAction: boolean;
	readonly hasChangeProjectIconAction?: boolean;
}): ProjectHeaderOverflowMenuState {
	const hasIcon = Boolean(input.projectIconSrc);
	const hasResetProjectIcon = Boolean(hasIcon && input.hasResetProjectIconAction);
	const showColorPicker = Boolean(input.hasColorChange && !hasIcon);
	const showSettingsSection = Boolean(
		showColorPicker ||
			input.hasRemoveProjectAction ||
			hasResetProjectIcon ||
			input.hasChangeProjectIconAction
	);

	return {
		selectedColorHex: getSelectedProjectColorHex({
			currentColor: input.currentColor,
			colorOptions: input.colorOptions,
		}),
		hasIcon,
		hasResetProjectIcon,
		showColorPicker,
		showSettingsSection,
	};
}
