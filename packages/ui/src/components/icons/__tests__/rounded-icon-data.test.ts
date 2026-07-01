import { describe, expect, it } from "vitest";

import {
	resolveRoundedIconName,
	roundedIconAliasNames,
	roundedIconData,
} from "../rounded-icon-data.generated.js";

describe("rounded-icon-data", () => {
	it("resolves semantic shield aliases to RoundedIcon shield assets", () => {
		expect(resolveRoundedIconName("shield-warning")).toBe("shield-exclamation-kf9myntx");
		expect(resolveRoundedIconName("shield-check")).toBe("hooks-settings-dasiwpyv");
		expect(resolveRoundedIconName("shield-code")).toBe("shield-code-bqug9ybu");
	});

	it("resolves semantic app window alias to the RoundedIcon app-window asset", () => {
		expect(resolveRoundedIconName("app-window")).toBe("app-window-b6aaamvg");
	});

	it("resolves semantic globe alias to the RoundedIcon globe asset", () => {
		expect(resolveRoundedIconName("globe")).toBe("globe-oc2o98t5");
	});

	it("names Google Drive explicitly instead of exposing it as generic Google", () => {
		expect(roundedIconAliasNames).not.toContain("google");
		expect(resolveRoundedIconName("google-drive")).toBe("google-drive-cc-egn92");
	});

	it("resolves semantic file text alias to the RoundedIcon file-text asset", () => {
		expect(resolveRoundedIconName("file-text")).toBe("get-file-icon-emolzufn--07");
	});

	it("resolves semantic git diff alias to the RoundedIcon diff asset", () => {
		expect(resolveRoundedIconName("git-diff")).toBe("diff-unified-bj8g3qql--01");
	});

	it("resolves exact UI utility aliases to RoundedIcon assets", () => {
		expect(resolveRoundedIconName("bell")).toBe("automations-page-5wt3epnk");
		expect(resolveRoundedIconName("brain")).toBe("reasoning-minimal-lzpeywud--08");
		expect(resolveRoundedIconName("chart-line")).toBe("pricing-plan-page-bojp7gtn--31");
		expect(resolveRoundedIconName("circle-dashed")).toBe("pull-request-status-bdnvgysd--01");
		expect(resolveRoundedIconName("microphone")).toBe("use-is-dictation-supported-cfnkis4k--06");
		expect(resolveRoundedIconName("moon")).toBe("gpu-tearing-debug-settings-b8w-l8wh");
		expect(resolveRoundedIconName("sparkle")).toBe("profile-dropdown-d8zfwx8a--02");
	});

	it("resolves semantic eye alias to the RoundedIcon eye asset", () => {
		expect(resolveRoundedIconName("eye")).toBe("review-header-toolbar-adr062sp--02");
	});

	it("resolves semantic laptop alias to the RoundedIcon laptop asset", () => {
		expect(resolveRoundedIconName("laptop")).toBe("laptop-dvgdtu4m");
	});

	it("resolves semantic right arrow alias to the RoundedIcon right arrow asset", () => {
		expect(resolveRoundedIconName("arrow-right")).toBe("app-main-b9iamgew--01");
	});

	it("resolves semantic paper plane alias to the RoundedIcon filled paper plane asset", () => {
		expect(resolveRoundedIconName("paper-plane")).toBe("thread-side-panel-tabs-qmoazjz--02");
		expect(resolveRoundedIconName("send")).toBe("send-to-cloud-d84lbipu");
	});

	it("resolves semantic counter-clockwise arrow alias to the RoundedIcon asset", () => {
		expect(resolveRoundedIconName("arrow-counter-clockwise")).toBe("arrow-rotate-ccw-b3tr4czg");
	});

	it("includes the RoundedIcon hand icon for question status", () => {
		expect(resolveRoundedIconName("hand")).toBe("hand");
		expect(roundedIconData.hand.viewBox).toBe("0 0 20 20");
	});
});
