import { describe, expect, it } from "vitest";

import { linearIconNames } from "../linear-icon-catalog.js";
import {
	roundedIconAliasNames,
	roundedIconNames,
	type RoundedIconName,
} from "../rounded-icon-data.generated.js";
import {
	isAcepeOnlyRoundedIcon,
	mapRoundedIconToLinear,
	roundedToLinearMap,
} from "../rounded-to-linear-map.js";

const linearIconNameSet = new Set<string>(linearIconNames);

describe("rounded-to-linear-map", () => {
	it("maps every rounded icon name and alias to a Linear catalog entry", () => {
		const allNames: RoundedIconName[] = [
			...roundedIconNames,
			...roundedIconAliasNames,
		];

		for (const name of allNames) {
			const linearName = mapRoundedIconToLinear(name);
			expect(linearIconNameSet.has(linearName)).toBe(true);
		}
	});

	it("keeps acepe-only fallbacks disjoint from automatic Linear rendering", () => {
		for (const name of roundedToLinearMap["acepe-only"]) {
			expect(isAcepeOnlyRoundedIcon(name)).toBe(true);
		}
	});

	it("maps aliases to their dedicated Linear targets when provided", () => {
		expect(mapRoundedIconToLinear("bell")).toBe("alarm");
		expect(mapRoundedIconToLinear("automations")).toBe("automation");
	});
});
