import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import { REDACTED_SECRET, SECRET_FIELD_ALLOWLIST, isSecretField, redactSecrets } from "./redact.ts"

const json = (value: Schema.Json): Schema.Json => value

Vitest.describe("SECRET_FIELD_ALLOWLIST", () => {
	Vitest.it("names the secret fields that recording must redact", () => {
		Vitest.assert.deepStrictEqual(
			[...SECRET_FIELD_ALLOWLIST],
			[
				"ANTHROPIC_API_KEY",
				"API_KEY",
				"Authorization",
				"OPENAI_API_KEY",
				"accessToken",
				"access_token",
				"anthropicApiKey",
				"apiKey",
				"api_key",
				"authToken",
				"auth_token",
				"authorization",
				"bearerToken",
				"bearer_token",
				"openaiApiKey",
				"password",
				"privateKey",
				"private_key",
				"refreshToken",
				"refresh_token",
				"secret",
				"sessionToken",
				"session_token",
			],
		)
		Vitest.assert.isTrue(isSecretField("apiKey"))
		Vitest.assert.isFalse(isSecretField("sessionId"))
	})
})

Vitest.describe("redactSecrets", () => {
	Vitest.it("replaces allowlisted fields and keeps every other field", () => {
		const redacted = redactSecrets(
			json({
				sessionId: "session-1",
				apiKey: "sk-live-secret",
				nested: {
					password: "hunter2",
					cwd: "/Users/alex/Documents/acepe",
				},
			}),
		)
		Vitest.assert.deepStrictEqual(redacted, {
			sessionId: "session-1",
			apiKey: REDACTED_SECRET,
			nested: {
				password: REDACTED_SECRET,
				cwd: "/Users/alex/Documents/acepe",
			},
		})
	})

	Vitest.it("redacts allowlisted fields inside arrays", () => {
		const redacted = redactSecrets(
			json({
				keys: [{ api_key: "abc", name: "anthropic" }, { token: "leave-this" }],
			}),
		)
		Vitest.assert.deepStrictEqual(redacted, {
			keys: [{ api_key: REDACTED_SECRET, name: "anthropic" }, { token: "leave-this" }],
		})
	})

	Vitest.it("leaves primitives unchanged", () => {
		Vitest.assert.strictEqual(redactSecrets("ok"), "ok")
		Vitest.assert.strictEqual(redactSecrets(3), 3)
		Vitest.assert.strictEqual(redactSecrets(true), true)
		Vitest.assert.strictEqual(redactSecrets(null), null)
	})
})
