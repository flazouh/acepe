import { linearIconData } from "./linear-icon-catalog.js";
import {
	isAcepeOnlyRoundedIcon,
	mapRoundedIconToLinear,
} from "./rounded-to-linear-map.js";
import {
	resolveRoundedIconName,
	roundedIconData,
	type RoundedIconName,
} from "./rounded-icon-data.generated.js";

export type ResolvedIconGlyph = {
	readonly viewBox: string;
	readonly inner: string;
};

export function resolveRoundedIconGlyph(name: RoundedIconName): ResolvedIconGlyph {
	const sourceName = resolveRoundedIconName(name);

	if (isAcepeOnlyRoundedIcon(sourceName)) {
		return roundedIconData[sourceName];
	}

	const linearName = mapRoundedIconToLinear(name);
	return linearIconData[linearName];
}
