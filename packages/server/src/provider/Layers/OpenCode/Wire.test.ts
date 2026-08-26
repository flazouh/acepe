import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	buildPromptBody,
	canonicalModelId,
	isSafeRequestId,
	openCodeUrls,
	parseModelSelection,
	resolveConfiguredModel
} from "./Wire.ts"

const includesAcpPath = (value: string): boolean =>
	value.includes("/acp") || value.includes("session/prompt")

Vitest.describe("OpenCode native protocol helpers", () => {
	Vitest.it("builds HTTP paths, not ACP JSON-RPC methods", () => {
		const urls = openCodeUrls("http://127.0.0.1:4096")
		Vitest.assert.strictEqual(urls.session, "http://127.0.0.1:4096/session")
		Vitest.assert.strictEqual(
			urls.promptAsync("ses_test_123"),
			"http://127.0.0.1:4096/session/ses_test_123/prompt_async"
		)
		Vitest.assert.strictEqual(
			urls.permissionReply("perm_req_abc123"),
			"http://127.0.0.1:4096/permission/perm_req_abc123/reply"
		)
		Vitest.assert.strictEqual(
			urls.questionReply("ques_req_xyz789"),
			"http://127.0.0.1:4096/question/ques_req_xyz789/reply"
		)
		Vitest.assert.strictEqual(urls.globalEvent, "http://127.0.0.1:4096/global/event")
		Vitest.assert.strictEqual(includesAcpPath(urls.promptAsync("ses_1")), false)
	})

	Vitest.it("rejects unsafe permission request ids", () => {
		Vitest.assert.strictEqual(isSafeRequestId("perm_req_abc123"), true)
		Vitest.assert.strictEqual(isSafeRequestId(""), false)
		Vitest.assert.strictEqual(isSafeRequestId("../../etc/passwd"), false)
	})

	Vitest.it("parses provider/model ids", () => {
		const parsed = parseModelSelection("openrouter/anthropic/claude-sonnet-4.6")
		Vitest.assert.deepStrictEqual(
			parsed,
			Option.some({
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4.6"
			})
		)
		if (Option.isSome(parsed)) {
			Vitest.assert.strictEqual(
				canonicalModelId(parsed.value),
				"openrouter/anthropic/claude-sonnet-4.6"
			)
		}
		Vitest.assert.strictEqual(Option.isNone(parseModelSelection("sonnet")), true)
	})

	Vitest.it("builds the native prompt_async body", () => {
		const body = buildPromptBody({
			directory: "/tmp/project",
			model: {
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4.6"
			},
			agent: "build",
			text: "Hello"
		})
		Vitest.assert.strictEqual(body.model.providerID, "openrouter")
		Vitest.assert.strictEqual(body.model.modelID, "anthropic/claude-sonnet-4.6")
		Vitest.assert.strictEqual(body.agent, "build")
		Vitest.assert.strictEqual(body.parts[0]?.text, "Hello")
	})

	Vitest.it("resolves a unique leaf model id against connected providers", () => {
		Vitest.assert.deepStrictEqual(
			resolveConfiguredModel("claude-sonnet-4.6", [
				"openrouter/claude-sonnet-4.6"
			]),
			Option.some("openrouter/claude-sonnet-4.6")
		)
		Vitest.assert.strictEqual(
			Option.isNone(
				resolveConfiguredModel("claude-sonnet-4.6", [
					"openrouter/claude-sonnet-4.6",
					"github-copilot/claude-sonnet-4.6"
				])
			),
			true
		)
	})
})
