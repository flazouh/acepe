import { describe, expect, it } from "vitest";

import {
	roundedIconAliasNames,
	roundedIconNames,
	type RoundedIconName,
} from "../rounded-icon-data.generated.js";
import {
	confirmedLinearInterfaceMappings,
	mapRoundedIconToLinear,
} from "../rounded-to-linear-map.js";

describe("rounded-to-linear-map", () => {
	it("has no approved runtime Linear mappings while the corpus is under retrace", () => {
		expect(Object.keys(confirmedLinearInterfaceMappings)).toEqual([]);
	});

	it("falls back for every runtime icon name and alias", () => {
		const allNames: RoundedIconName[] = [];
		for (const name of roundedIconNames) {
			allNames.push(name);
		}
		for (const name of roundedIconAliasNames) {
			allNames.push(name);
		}

		for (const name of allNames) {
			expect(mapRoundedIconToLinear(name)).toBeNull();
		}
	});
});
