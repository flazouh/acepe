import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { comparePluginVersions, latestPluginVersion } from "./pluginVersions.ts"

Vitest.describe("comparePluginVersions", () => {
	Vitest.it("orders semver the same way rust does", () => {
		Vitest.assert.strictEqual(comparePluginVersions("1.0.0", "1.0.0"), 0)
		Vitest.assert.strictEqual(comparePluginVersions("1.0.1", "1.0.0"), 1)
		Vitest.assert.strictEqual(comparePluginVersions("1.0.0", "1.0.1"), -1)
		Vitest.assert.strictEqual(comparePluginVersions("2.0.0", "1.9.9"), 1)
		Vitest.assert.strictEqual(comparePluginVersions("4.0.3", "3.9.9"), 1)
	})

	Vitest.it("treats a longer matching prefix as greater", () => {
		Vitest.assert.strictEqual(comparePluginVersions("1.0.0.1", "1.0.0"), 1)
		Vitest.assert.strictEqual(comparePluginVersions("1.0", "1.0.0"), -1)
	})

	Vitest.it("falls back to string order for non-semver versions", () => {
		Vitest.assert.strictEqual(comparePluginVersions("abc123", "abc122"), 1)
	})
})

Vitest.describe("latestPluginVersion", () => {
	Vitest.it("picks the highest semver directory", () => {
		const latest = latestPluginVersion(["1.0.0", "1.2.0", "1.1.9"])
		Vitest.assert.strictEqual(Option.isSome(latest), true)
		if (Option.isSome(latest)) {
			Vitest.assert.strictEqual(latest.value, "1.2.0")
		}
	})
})
