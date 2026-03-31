import * as m from "$lib/paraglide/messages.js";

import { COLOR_NAMES, Colors } from "./colors.js";

type ProjectColorLabel = ReturnType<typeof m.project_color_red>;

export interface ProjectColorOption {
	readonly name: string;
	readonly hex: string;
	readonly label: () => ProjectColorLabel;
}

export const PROJECT_COLOR_OPTIONS: readonly ProjectColorOption[] = [
	{ name: COLOR_NAMES.RED, hex: Colors[COLOR_NAMES.RED], label: () => m.project_color_red() },
	{
		name: COLOR_NAMES.ORANGE,
		hex: Colors[COLOR_NAMES.ORANGE],
		label: () => m.project_color_orange(),
	},
	{
		name: COLOR_NAMES.AMBER,
		hex: Colors[COLOR_NAMES.AMBER],
		label: () => m.project_color_amber(),
	},
	{
		name: COLOR_NAMES.YELLOW,
		hex: Colors[COLOR_NAMES.YELLOW],
		label: () => m.project_color_yellow(),
	},
	{
		name: COLOR_NAMES.LIME,
		hex: Colors[COLOR_NAMES.LIME],
		label: () => m.project_color_lime(),
	},
	{
		name: COLOR_NAMES.GREEN,
		hex: Colors[COLOR_NAMES.GREEN],
		label: () => m.project_color_green(),
	},
	{
		name: COLOR_NAMES.TEAL,
		hex: Colors[COLOR_NAMES.TEAL],
		label: () => m.project_color_teal(),
	},
	{ name: COLOR_NAMES.CYAN, hex: Colors[COLOR_NAMES.CYAN], label: () => m.project_color_cyan() },
	{
		name: COLOR_NAMES.BLUE,
		hex: Colors[COLOR_NAMES.BLUE],
		label: () => m.project_color_blue(),
	},
	{
		name: COLOR_NAMES.INDIGO,
		hex: Colors[COLOR_NAMES.INDIGO],
		label: () => m.project_color_indigo(),
	},
	{
		name: COLOR_NAMES.PURPLE,
		hex: Colors[COLOR_NAMES.PURPLE],
		label: () => m.project_color_purple(),
	},
	{ name: COLOR_NAMES.PINK, hex: Colors[COLOR_NAMES.PINK], label: () => m.project_color_pink() },
];
