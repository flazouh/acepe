import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	resolveRoundedIconName,
	roundedIconAliasNames,
	roundedIconAliases,
	roundedIconData,
	roundedIconNames,
	roundedIconSourceNames,
} from "../rounded-icon-data.generated.js";
import {
	formatRoundedIconName,
	recommendedRoundedIconNames,
	roundedIconLibrary,
} from "../rounded-icon-library.js";

describe("rounded-icon-data", () => {
	it("preserves currentColor strokes from extracted Codex tool icons", () => {
		expect(roundedIconData["tool-read"].inner).toContain('stroke="currentColor"');
		expect(roundedIconData["tool-read"].inner).toContain('fill="none"');
	});

	it("uses the rounded Codex terminal geometry for execute tools", () => {
		const terminalIcon = roundedIconData.terminal;

		expect(terminalIcon.viewBox).toBe("0 0 20 20");
		expect(terminalIcon.inner).toContain('fill-rule="evenodd"');
		expect(terminalIcon.inner).not.toContain("<rect");
	});

	it("resolves semantic shield aliases to RoundedIcon shield assets", () => {
		expect(resolveRoundedIconName("shield-warning")).toBe("shield-warning");
		expect(resolveRoundedIconName("shield-check")).toBe("shield-check");
		expect(resolveRoundedIconName("shield-code")).toBe("shield-code");
	});

	it("resolves semantic app window alias to the RoundedIcon app-window asset", () => {
		expect(resolveRoundedIconName("app-window")).toBe("app-window");
	});

	it("resolves semantic globe alias to the RoundedIcon globe asset", () => {
		expect(resolveRoundedIconName("globe")).toBe("globe");
		expect(resolveRoundedIconName("browser")).toBe("globe");
	});

	it("names Google Drive explicitly instead of exposing it as generic Google", () => {
		expect(roundedIconAliasNames).not.toContain("google");
		expect(resolveRoundedIconName("google-drive")).toBe("google-drive");
	});

	it("resolves semantic file text alias to the RoundedIcon file-text asset", () => {
		expect(resolveRoundedIconName("file-text")).toBe("file-text");
	});

	it("resolves semantic git diff alias to the RoundedIcon diff asset", () => {
		expect(resolveRoundedIconName("git-diff")).toBe("git-diff");
		expect(resolveRoundedIconName("git-diff-unified")).toBe(
			"git-diff-unified",
		);
	});

	it("resolves exact UI utility aliases to RoundedIcon assets", () => {
		expect(resolveRoundedIconName("bell")).toBe("automations");
		expect(resolveRoundedIconName("brain")).toBe("brain");
		expect(resolveRoundedIconName("chart-line")).toBe("chart-line");
		expect(resolveRoundedIconName("circle-dashed")).toBe("circle-dashed");
		expect(resolveRoundedIconName("microphone")).toBe("microphone");
		expect(resolveRoundedIconName("moon")).toBe("gpu");
		expect(resolveRoundedIconName("sparkle")).toBe("sparkle");
	});

	it("resolves semantic eye alias to the RoundedIcon eye asset", () => {
		expect(resolveRoundedIconName("eye")).toBe("eye");
	});

	it("resolves semantic laptop alias to the RoundedIcon laptop asset", () => {
		expect(resolveRoundedIconName("laptop")).toBe("laptop");
	});

	it("resolves semantic right arrow alias to the RoundedIcon right arrow asset", () => {
		expect(resolveRoundedIconName("arrow-right")).toBe("arrow-right");
	});

	it("resolves sidebar state aliases to the matching RoundedIcon assets", () => {
		expect(resolveRoundedIconName("sidebar-open")).toBe("sidebar-open");
		expect(resolveRoundedIconName("sidebar-closed")).toBe("sidebar");
	});

	it("resolves semantic paper plane alias to the RoundedIcon filled paper plane asset", () => {
		expect(resolveRoundedIconName("paper-plane")).toBe("paper-plane");
		expect(resolveRoundedIconName("send")).toBe("send");
	});

	it("resolves semantic counter-clockwise arrow alias to the RoundedIcon asset", () => {
		expect(resolveRoundedIconName("arrow-counter-clockwise")).toBe(
			"arrow-counter-clockwise",
		);
	});

	it("includes the RoundedIcon hand icon for question status", () => {
		expect(resolveRoundedIconName("hand")).toBe("hand");
		expect(roundedIconData.hand.viewBox).toBe("0 0 20 20");
	});

	it("includes exact diff settings icons", () => {
		expect(roundedIconData["diff-bars"].viewBox).toBe("0 0 16 16");
		expect(roundedIconData["diff-classic"].viewBox).toBe("0 0 16 16");
		expect(roundedIconData["diff-backgrounds"].viewBox).toBe("0 0 16 16");
		expect(roundedIconData["diff-wrapping"].viewBox).toBe("0 0 16 16");
		expect(roundedIconData["diff-line-numbers"].viewBox).toBe("0 0 16 16");
	});

	it("keeps every public alias wired to generated icon data", () => {
		for (const aliasName of roundedIconAliasNames) {
			const sourceName = roundedIconAliases[aliasName];

			expect(roundedIconSourceNames).toContain(sourceName);
			expect(roundedIconData[sourceName]).toBeDefined();
			expect(resolveRoundedIconName(aliasName)).toBe(sourceName);
		}
	});

	it("returns source icon names unchanged", () => {
		expect(roundedIconSourceNames).toBe(roundedIconNames);

		for (const sourceName of roundedIconSourceNames) {
			expect(resolveRoundedIconName(sourceName)).toBe(sourceName);
		}
	});

	it("exposes a pretty public icon library based on clean SVG names", () => {
		expect(recommendedRoundedIconNames).toBe(roundedIconNames);
		expect(roundedIconLibrary).toHaveLength(roundedIconNames.length);
		expect(roundedIconLibrary[0]).toEqual({
			name: "add",
			fileName: "add.svg",
			label: "Add",
		});
		for (const iconName of recommendedRoundedIconNames) {
			expect(iconName).not.toContain("--");
		}
		expect(formatRoundedIconName("arrow-counter-clockwise")).toBe(
			"Arrow Counter Clockwise",
		);
	});

	it("keeps clean SVG files as the rounded icon source of truth", () => {
		const svgDirectoryUrl = new URL("../svg/", import.meta.url);
		const svgFileNames = readdirSync(svgDirectoryUrl).sort();

		expect(svgFileNames).toEqual(
			roundedIconNames.map((iconName) => `${iconName}.svg`),
		);

		for (const fileName of svgFileNames) {
			expect(fileName).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/);

			const svg = readFileSync(new URL(`../svg/${fileName}`, import.meta.url), {
				encoding: "utf8",
			});
			expect(svg).toContain("<svg");
			expect(svg).toContain("viewBox=");
			expect(svg).toContain("</svg>");
			expect(svg).not.toContain("#0D0D0D");
			expect(svg).not.toContain("#0d0d0d");
		}
	});
});
