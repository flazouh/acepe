import { describe, expect, it } from "bun:test";

import { cylinderIn, cylinderOut } from "./cylinder-transition.js";

const node = {} as unknown as Element;

describe("cylinder transitions", () => {
	it("rolls the incoming line up into resting position", () => {
		const config = cylinderIn(node, { duration: 300 });
		expect(config.duration).toBe(300);
		// At t=1 (settled) there is no rotation, no shift, full opacity.
		const settled = config.css?.(1, 0) ?? "";
		expect(settled).toContain("rotateX(0deg)");
		expect(settled).toContain("translateY(0%)");
		expect(settled).toContain("opacity: 1");
		// At t=0 (entering) it starts rotated below the drum and transparent.
		const entering = config.css?.(0, 1) ?? "";
		expect(entering).toContain("rotateX(-72deg)");
		expect(entering).toContain("opacity: 0");
	});

	it("rolls the outgoing line up and away off the drum", () => {
		const config = cylinderOut(node, { duration: 300 });
		// At t=1 (still resting) no rotation; at t=0 (gone) rotated up and transparent.
		const resting = config.css?.(1, 0) ?? "";
		expect(resting).toContain("rotateX(0deg)");
		expect(resting).toContain("opacity: 1");
		const gone = config.css?.(0, 1) ?? "";
		expect(gone).toContain("rotateX(72deg)");
		expect(gone).toContain("opacity: 0");
	});

	it("honors custom rotation and travel", () => {
		const config = cylinderIn(node, { rotation: 90, travel: 50 });
		const entering = config.css?.(0, 1) ?? "";
		expect(entering).toContain("rotateX(-90deg)");
		expect(entering).toContain("translateY(50%)");
	});
});
