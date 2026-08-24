import * as Schema from "effect/Schema"

// ~/.claude.json (Claude Code's own account file) and the Keychain/
// credentials-file-held OAuth blob. Field names are camelCase because
// that's what's actually on the wire in both files -- the Rust struct used
// #[serde(rename_all = "camelCase")] over snake_case Rust field names, so
// the JSON itself was already camelCase.

export const ClaudeOAuthAccount = Schema.Struct({
	organizationUuid: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
	billingType: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ClaudeOAuthAccount = typeof ClaudeOAuthAccount.Type

export const ClaudeAccountConfig = Schema.Struct({
	hasAvailableSubscription: Schema.Boolean.pipe(Schema.NullOr, Schema.optionalKey),
	oauthAccount: ClaudeOAuthAccount.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ClaudeAccountConfig = typeof ClaudeAccountConfig.Type

export const ClaudeCodeOAuthCredentials = Schema.Struct({
	accessToken: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ClaudeCodeOAuthCredentials = typeof ClaudeCodeOAuthCredentials.Type

export const ClaudeCodeCredentials = Schema.Struct({
	claudeAiOauth: ClaudeCodeOAuthCredentials.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ClaudeCodeCredentials = typeof ClaudeCodeCredentials.Type

export const decodeClaudeAccountConfigJson = Schema.decodeUnknownEffect(Schema.fromJsonString(ClaudeAccountConfig))
export const decodeClaudeCodeCredentialsJson = Schema.decodeUnknownEffect(
	Schema.fromJsonString(ClaudeCodeCredentials),
)
