import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { isCapabilityEnabled } from "../Services/ProviderAdapter.ts"
import {
	isOpenCodePlanCapabilityEnabled,
	normalizeOpenCodeServeArgs,
	OPENCODE_CAPABILITIES,
	OPENCODE_COMMUNICATION_MODE,
	OPENCODE_DEFAULT_MODE,
	OPENCODE_DEFERRED_SESSION_CREATION,
	OPENCODE_MODES,
	OPENCODE_PROVIDER_ID,
	openCodeBaseUrl,
	openCodePresence,
	openCodeServeArgs,
	parseServeUrl
} from "./OpenCodeProvider.ts"

Vitest.describe("OpenCodeProvider", () => {
	Vitest.it("uses the opencode provider id", () => {
		Vitest.assert.strictEqual(OPENCODE_PROVIDER_ID, "opencode")
	})

	Vitest.it("uses native HTTP, not ACP", () => {
		Vitest.assert.strictEqual(OPENCODE_COMMUNICATION_MODE, "http")
		Vitest.assert.strictEqual(OPENCODE_DEFERRED_SESSION_CREATION, false)
	})

	Vitest.it("defaults to build and plan modes", () => {
		Vitest.assert.deepStrictEqual(OPENCODE_MODES, ["build", "plan"])
		Vitest.assert.strictEqual(OPENCODE_DEFAULT_MODE, "build")
	})

	Vitest.it("enables plan, usage, tool, and permission capabilities as data", () => {
		Vitest.assert.strictEqual(isCapabilityEnabled(OPENCODE_CAPABILITIES, "plan"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(OPENCODE_CAPABILITIES, "usage"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(OPENCODE_CAPABILITIES, "toolCalls"), true)
		Vitest.assert.strictEqual(
			isCapabilityEnabled(OPENCODE_CAPABILITIES, "permissionRequests"),
			true
		)
		Vitest.assert.strictEqual(isCapabilityEnabled(OPENCODE_CAPABILITIES, "autonomous"), false)
		Vitest.assert.strictEqual(isOpenCodePlanCapabilityEnabled(), true)
	})

	Vitest.it("replaces empty or ACP launch args with serve", () => {
		Vitest.assert.deepStrictEqual(normalizeOpenCodeServeArgs([]), ["serve"])
		Vitest.assert.deepStrictEqual(normalizeOpenCodeServeArgs(["acp"]), ["serve"])
		Vitest.assert.deepStrictEqual(normalizeOpenCodeServeArgs(["serve", "--hostname", "127.0.0.1"]), [
			"serve",
			"--hostname",
			"127.0.0.1"
		])
		Vitest.assert.deepStrictEqual(openCodeServeArgs(["acp"]), ["serve", "--port", "0"])
	})

	Vitest.it("parses port and API prefix from serve stdout", () => {
		const parsed = parseServeUrl("Listening on http://127.0.0.1:4096/api")
		Vitest.assert.deepStrictEqual(parsed, Option.some({ port: 4096, apiPrefix: "/api" }))
		const root = parseServeUrl("opencode http://127.0.0.1:8080")
		Vitest.assert.deepStrictEqual(root, Option.some({ port: 8080, apiPrefix: "" }))
		Vitest.assert.strictEqual(Option.isNone(parseServeUrl("starting")), true)
		if (Option.isSome(root)) {
			Vitest.assert.strictEqual(openCodeBaseUrl(root.value), "http://127.0.0.1:8080")
		}
	})

	Vitest.it("reports presence without reading process.env", () => {
		const presence = openCodePresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, OPENCODE_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})

	Vitest.it("does not enable every catalog capability by default", () => {
		Vitest.assert.strictEqual(
			Arr.contains(OPENCODE_CAPABILITIES.enabled, "configOptions"),
			false
		)
	})
})
