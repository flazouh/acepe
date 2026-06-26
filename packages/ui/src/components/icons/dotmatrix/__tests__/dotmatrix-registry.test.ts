import { describe, expect, it } from "vitest";

import { buildDotmatrixBaseViewModel } from "../dotmatrix-base-logic.js";
import { getDotmatrixLoaderConfig, DOTMATRIX_LOADER_IDS } from "../loaders/index.js";
import type { DotmatrixLoaderRuntime } from "../loader-types.js";

const idleRuntime: DotmatrixLoaderRuntime = {
	reducedMotion: false,
	matrixPhase: "loadingRipple",
	cyclePhase: 0.25,
	cycleStep: 3,
};

describe("dotmatrix loader registry", () => {
	it("registers all 40 square and circular loaders", () => {
		expect(DOTMATRIX_LOADER_IDS.length).toBe(40);
		for (const id of DOTMATRIX_LOADER_IDS) {
			expect(getDotmatrixLoaderConfig(id)).toBeDefined();
		}
	});

	it("dotm-square-3 produces active spiral-snake dots", () => {
		const config = getDotmatrixLoaderConfig("dotm-square-3");
		expect(config).toBeDefined();
		if (!config) {
			return;
		}

		const resolver = config.createAnimationResolver(idleRuntime);
		const viewModel = buildDotmatrixBaseViewModel({
			size: 36,
			dotSize: 5,
			color: "currentColor",
			speed: config.defaultSpeed,
			pattern: config.defaultPattern,
			dotShape: "circle",
			muted: false,
			bloom: false,
			halo: 0,
			phase: "loadingRipple",
			reducedMotion: false,
			animationResolver: resolver,
		});

		const animatedDots = viewModel.dots.filter((dot) => dot.className.includes("dmx-spiral-snake"));
		expect(animatedDots.length).toBeGreaterThan(0);
		expect(viewModel.dots.length).toBe(25);
	});

	it("dotm-circular-1 masks corners and animates strand cells", () => {
		const config = getDotmatrixLoaderConfig("dotm-circular-1");
		expect(config).toBeDefined();
		if (!config) {
			return;
		}

		const resolver = config.createAnimationResolver(idleRuntime);
		const viewModel = buildDotmatrixBaseViewModel({
			size: 36,
			dotSize: 5,
			color: "currentColor",
			speed: config.defaultSpeed,
			pattern: config.defaultPattern,
			dotShape: "circle",
			muted: false,
			bloom: false,
			halo: 0,
			phase: "loadingRipple",
			reducedMotion: false,
			animationResolver: resolver,
		});

		const cornerIndexes = [0, 4, 20, 24];
		for (const index of cornerIndexes) {
			const corner = viewModel.dots.find((dot) => dot.index === index);
			expect(corner?.className.includes("dmx-inactive")).toBe(true);
		}

		const litDots = viewModel.dots.filter((dot) => {
			const opacity = dot.style.opacity;
			return typeof opacity === "number" && opacity > 0.5;
		});
		expect(litDots.length).toBeGreaterThan(0);
	});
});
