import * as Arr from "effect/Array"
import * as HashSet from "effect/HashSet"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"

/**
 * Field names treated as secrets when recording sidecar traffic.
 * Only these keys are redacted. Every other field is kept.
 */
export const SECRET_FIELD_ALLOWLIST = [
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
] as const

export const REDACTED_SECRET = "[REDACTED]"

const secretFields = HashSet.fromIterable<string>(SECRET_FIELD_ALLOWLIST)
const isJsonArray = Schema.is(Schema.Array(Schema.Json))
const isJsonRecord = Schema.is(Schema.Record(Schema.String, Schema.Json))

export const isSecretField = (field: string): boolean => HashSet.has(secretFields, field)

export const redactSecrets = (value: Schema.Json): Schema.Json => {
	if (
		Predicate.isNull(value) ||
		Predicate.isNumber(value) ||
		Predicate.isBoolean(value) ||
		Predicate.isString(value)
	) {
		return value
	}
	if (isJsonArray(value)) {
		return Arr.map(value, redactSecrets)
	}
	if (isJsonRecord(value)) {
		return Rec.map(value, (child, key) => (isSecretField(key) ? REDACTED_SECRET : redactSecrets(child)))
	}
	return value
}
