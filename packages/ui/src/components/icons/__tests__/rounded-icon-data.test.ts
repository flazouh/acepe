import { describe, expect, it } from "vitest";

import { resolveRoundedIconName } from "../rounded-icon-data.generated.js";

describe("rounded-icon-data", () => {
	it("resolves semantic shield aliases to Codex rounded shield assets", () => {
		expect(resolveRoundedIconName("shield-warning")).toBe("shield-exclamation-kf9myntx");
		expect(resolveRoundedIconName("shield-code")).toBe("shield-code-bqug9ybu");
	});

	it("resolves semantic app window alias to the Codex rounded app-window asset", () => {
		expect(resolveRoundedIconName("app-window")).toBe("app-window-b6aaamvg");
	});
});
