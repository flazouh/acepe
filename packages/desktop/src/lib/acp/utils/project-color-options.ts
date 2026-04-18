import { COLOR_NAMES, Colors } from "./colors.js";

type ProjectColorLabel = string;

export interface ProjectColorOption {
	readonly name: string;
	readonly hex: string;
	readonly label: () => ProjectColorLabel;
}

export const PROJECT_COLOR_OPTIONS: readonly ProjectColorOption[] = [
	{ name: COLOR_NAMES.RED, hex: Colors[COLOR_NAMES.RED], label: () => "Red" },
	{
		name: COLOR_NAMES.ORANGE,
		hex: Colors[COLOR_NAMES.ORANGE],
		label: () => "Orange",
	},
	{
		name: COLOR_NAMES.AMBER,
		hex: Colors[COLOR_NAMES.AMBER],
		label: () => "Amber",
	},
	{
		name: COLOR_NAMES.YELLOW,
		hex: Colors[COLOR_NAMES.YELLOW],
		label: () => "Yellow",
	},
	{
		name: COLOR_NAMES.LIME,
		hex: Colors[COLOR_NAMES.LIME],
		label: () => "Lime",
	},
	{
		name: COLOR_NAMES.GREEN,
		hex: Colors[COLOR_NAMES.GREEN],
		label: () => "Green",
	},
	{
		name: COLOR_NAMES.TEAL,
		hex: Colors[COLOR_NAMES.TEAL],
		label: () => "Teal",
	},
	{ name: COLOR_NAMES.CYAN, hex: Colors[COLOR_NAMES.CYAN], label: () => "Cyan" },
	{
		name: COLOR_NAMES.BLUE,
		hex: Colors[COLOR_NAMES.BLUE],
		label: () => "Blue",
	},
	{
		name: COLOR_NAMES.INDIGO,
		hex: Colors[COLOR_NAMES.INDIGO],
		label: () => "Indigo",
	},
	{
		name: COLOR_NAMES.PURPLE,
		hex: Colors[COLOR_NAMES.PURPLE],
		label: () => "Purple",
	},
	{ name: COLOR_NAMES.PINK, hex: Colors[COLOR_NAMES.PINK], label: () => "Pink" },
];
