import { linearIconData } from "./linear-icon-catalog.js";
import { mapRoundedIconToLinear } from "./rounded-to-linear-map.js";
import {
	resolveRoundedIconName,
	getRoundedIconFallbackData,
	type RoundedIconName,
} from "./rounded-icon-data.generated.js";

export type ResolvedIconGlyph = {
	readonly viewBox: string;
	readonly inner: string;
};

export function resolveRoundedIconGlyph(
	name: RoundedIconName,
): ResolvedIconGlyph {
	const sourceName = resolveRoundedIconName(name);
	const linearName = mapRoundedIconToLinear(name);

	if (linearName === null) {
		return getRoundedIconFallbackData(sourceName);
	}
	return linearIconData[linearName];
}
