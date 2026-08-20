import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

import {
	defaultReleaseBaseUrl,
	demoUpdatePlan,
	nextCalver,
	patchArtifactsFrom,
	selectPatchArtifact,
} from "./updater.ts"

test("next calver steps N to N+1", () => {
	expect(nextCalver("2026.3.33")).toBe("2026.3.34")
})

test("updater is configured to emit a differential patch", () => {
	expect(defaultReleaseBaseUrl).toBe("https://github.com/flazouh/acepe/releases/latest/download")
	expect(demoUpdatePlan("2026.3.33").generatePatch).toBe(true)
})

test("local N to N+1 demo points the second build at the first artifacts", () => {
	const plan = demoUpdatePlan("2026.3.33")
	expect(plan.fromVersion).toBe("2026.3.33")
	expect(plan.toVersion).toBe("2026.3.34")
	expect(plan.secondBuildBaseUrl).toBe("http://127.0.0.1:41799/")
	expect(plan.generatePatch).toBe(true)
})

test("patch selector picks the delta file from electrobun artifacts", () => {
	const files = [
		"stable-macos-arm64-update.json",
		"stable-macos-arm64-Acepe.app.tar.zst",
		"stable-macos-arm64-a1b2c3d4.patch",
	]
	expect(selectPatchArtifact(files)).toBe("stable-macos-arm64-a1b2c3d4.patch")
})

test("N to N+1 patch artifacts include a patch file", () => {
	const artifacts = Effect.runSync(
		patchArtifactsFrom({
			fromVersion: "2026.3.33",
			toVersion: "2026.3.34",
			files: ["stable-macos-arm64-deadbeef.patch", "stable-macos-arm64-update.json"],
		}),
	)
	expect(artifacts.fromVersion).toBe("2026.3.33")
	expect(artifacts.toVersion).toBe("2026.3.34")
	expect(artifacts.patchFile).toBe("stable-macos-arm64-deadbeef.patch")
})

test("N to N+1 fails when the patch file is missing", () => {
	const exit = Effect.runSyncExit(
		patchArtifactsFrom({
			fromVersion: "2026.3.33",
			toVersion: "2026.3.34",
			files: ["stable-macos-arm64-update.json"],
		}),
	)
	expect(Exit.isFailure(exit)).toBe(true)
})
