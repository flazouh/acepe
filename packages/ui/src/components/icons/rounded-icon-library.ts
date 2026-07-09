import {
	roundedIconNames,
	type RoundedIconName,
	type RoundedIconSourceName,
} from "./rounded-icon-data.generated.js";

export type RoundedIconLibraryEntry = {
	readonly name: RoundedIconSourceName;
	readonly fileName: string;
	readonly label: string;
};

export const recommendedRoundedIconNames = roundedIconNames;

export function formatRoundedIconName(name: RoundedIconName): string {
	return name
		.split("-")
		.map((part) => {
			if (part.length === 0) {
				return part;
			}

			return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
		})
		.join(" ");
}

export const roundedIconLibrary: readonly RoundedIconLibraryEntry[] =
	roundedIconNames.map((name) => ({
		name,
		fileName: `${name}.svg`,
		label: formatRoundedIconName(name),
	}));
