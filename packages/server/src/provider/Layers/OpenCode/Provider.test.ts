import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { isCapabilityEnabled } from "../../Services/ProviderAdapter.ts"
import {
	isOpenCodePlanCapabilityEnabled,
	normalizeOpenCodeServeArgs,
	OPENCODE_ALLOWED_ENV_KEYS,
	OPENCODE_CAPABILITIES,
	OPENCODE_COMMUNICATION_MODE,
	OPENCODE_DEFAULT_MODE,
	OPENCODE_DEFERRED_SESSION_CREATION,
	OPENCODE_ISOLATED_CONFIG_ENV_KEY,
	OPENCODE_MODES,
	OPENCODE_PROVIDER_ID,
	openCodeBaseUrl,
	openCodePresence,
	openCodeServeArgs,
	parseServeUrl,
	resolveOpenCodeIsolatedConfigDir
} from "./Provider.ts"

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

	// Pins the isolation fix's mechanism: see OPENCODE_ISOLATED_CONFIG_ENV_KEY's
	// doc comment for the empirical evidence (opencode's real HTTP /agent and
	// /config endpoints, baseline vs XDG_CONFIG_HOME-overridden) that this
	// override is what stops ~/.config/opencode's personal MCP servers,
	// agents, and plugins from loading into a spawned `opencode serve`.
	Vitest.it("isolates opencode's config root via XDG_CONFIG_HOME, not the operator's HOME", () => {
		Vitest.assert.strictEqual(OPENCODE_ISOLATED_CONFIG_ENV_KEY, "XDG_CONFIG_HOME")
		// HOME stays in the passthrough allowlist (needed for auth under
		// $XDG_DATA_HOME's default, and for shell/PATH resolution) — isolation
		// works by overriding XDG_CONFIG_HOME on top of it, not by removing HOME.
		Vitest.assert.isTrue(Arr.contains(OPENCODE_ALLOWED_ENV_KEYS, "HOME"))
	})

	Vitest.it.effect("resolves the isolated config dir under the given tmp root", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const resolved = resolveOpenCodeIsolatedConfigDir(path, "/tmp")
			Vitest.assert.strictEqual(resolved, "/tmp/acepe-opencode-isolated-config")
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(BunPath.layer)
		)
	)
})
