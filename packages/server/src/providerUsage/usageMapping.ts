import type { ProviderAccountUsage, ProviderUsageWindow, ProviderUsageWindowRole } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Order from "effect/Order"
import type { CodexRateLimitSnapshot, CodexRateLimitWindow } from "./codexUsage.ts"
import { type ClaudeUsageApiResponse, type ClaudeUsageBucket, parseClaudeResetTimestampMs } from "./claudeUsageApi.ts"

// Ported from provider_account_usage/mod.rs's window-building and
// ProviderAccountUsage assembly (to_usage_window, codex_window_role,
// insert_claude_usage_window, claude_usage_response_to_snapshot,
// claude_snapshot_to_usage, unavailable_provider). A provider whose data
// cannot be read gets connection: "unavailable" with a human-readable
// `message` -- this module never fabricates a quota number.

const clampFraction = (value: number): number => {
	if (Number.isFinite(value) === false) {
		return 0
	}
	if (value < 0) {
		return 0
	}
	if (value > 1) {
		return 1
	}
	return value
}

export const unavailableProvider = (
	providerId: string,
	displayName: string,
	message: string,
	capturedAtMs: number,
): ProviderAccountUsage => ({
	providerId,
	displayName,
	plan: null,
	capturedAtMs,
	connection: "unavailable",
	windows: [],
	message,
})

// ─── Codex ──────────────────────────────────────────────────────────────

const codexWindowRole = (id: string): ProviderUsageWindowRole => {
	if (id === "primary") {
		return "primaryShort"
	}
	if (id === "secondary") {
		return "weekly"
	}
	return "other"
}

const toCodexUsageWindow = (id: string, label: string, window: CodexRateLimitWindow): ProviderUsageWindow => ({
	id,
	label,
	role: codexWindowRole(id),
	usedFraction: clampFraction(window.usedPercent / 100),
	windowMinutes: window.windowMinutes,
	resetsAtMs: window.resetsAtSeconds === null ? null : window.resetsAtSeconds * 1_000,
})

export const codexSnapshotToProviderUsage = (
	snapshot: CodexRateLimitSnapshot,
): ProviderAccountUsage => {
	const windows: Array<ProviderUsageWindow> = []
	if (snapshot.primary !== null) {
		windows.push(toCodexUsageWindow("primary", "5h window", snapshot.primary))
	}
	if (snapshot.secondary !== null) {
		windows.push(toCodexUsageWindow("secondary", "Weekly window", snapshot.secondary))
	}

	if (Arr.isReadonlyArrayEmpty(windows)) {
		return unavailableProvider(
			"codex",
			"Codex",
			"The latest Codex usage event had no quota windows",
			snapshot.capturedAtMs,
		)
	}

	return {
		providerId: "codex",
		displayName: "Codex",
		plan: snapshot.planType,
		capturedAtMs: snapshot.capturedAtMs,
		connection: "connected",
		windows,
		message: null,
	}
}

// ─── Claude ─────────────────────────────────────────────────────────────

type ClaudeWindowDefinition = {
	readonly id: string
	readonly label: string
	readonly role: ProviderUsageWindowRole
	readonly windowMinutes: number
}

const CLAUDE_WINDOW_DEFINITIONS: ReadonlyArray<
	ClaudeWindowDefinition & { readonly bucket: (response: ClaudeUsageApiResponse) => ClaudeUsageBucket | null | undefined }
> = [
	{ id: "five-hour", label: "5h window", role: "primaryShort", windowMinutes: 300, bucket: (r) => r.five_hour },
	{ id: "seven-day", label: "Weekly window", role: "weekly", windowMinutes: 10_080, bucket: (r) => r.seven_day },
	{
		id: "seven-day-sonnet",
		label: "Sonnet weekly",
		role: "weekly",
		windowMinutes: 10_080,
		bucket: (r) => r.seven_day_sonnet,
	},
	{
		id: "seven-day-opus",
		label: "Opus weekly",
		role: "weekly",
		windowMinutes: 10_080,
		bucket: (r) => r.seven_day_opus,
	},
	{
		id: "seven-day-cowork",
		label: "Cowork weekly",
		role: "weekly",
		windowMinutes: 10_080,
		bucket: (r) => r.seven_day_cowork,
	},
	{ id: "extra-usage", label: "Extra usage", role: "overage", windowMinutes: 0, bucket: (r) => r.extra_usage },
]

const byIdAscending = Order.mapInput(Order.String, (window: ProviderUsageWindow) => window.id)

// Rust's windows lived in a BTreeMap<String, ProviderUsageWindow>, which
// iterates in ascending key order -- sorting by id here reproduces that
// ordering (extra-usage, five-hour, seven-day, seven-day-cowork,
// seven-day-opus, seven-day-sonnet) rather than the definitions' own order.
export const claudeUsageResponseToWindows = (
	response: ClaudeUsageApiResponse,
	nowMs: number,
): ReadonlyArray<ProviderUsageWindow> => {
	const windows: Array<ProviderUsageWindow> = []
	for (const definition of CLAUDE_WINDOW_DEFINITIONS) {
		const bucket = definition.bucket(response)
		if (bucket === null || bucket === undefined) {
			continue
		}
		const resetsAtMs = parseClaudeResetTimestampMs(bucket.resets_at ?? null)
		const usedFraction = resetsAtMs !== null && resetsAtMs <= nowMs ? 0 : clampFraction(bucket.utilization / 100)
		windows.push({
			id: definition.id,
			label: definition.label,
			role: definition.role,
			usedFraction,
			windowMinutes: definition.windowMinutes,
			resetsAtMs,
		})
	}
	return Arr.sort(windows, byIdAscending)
}

export const claudeWindowsToProviderUsage = (
	windows: ReadonlyArray<ProviderUsageWindow>,
	plan: string | null,
	capturedAtMs: number,
	message: string | null,
): ProviderAccountUsage => {
	if (Arr.isReadonlyArrayEmpty(windows)) {
		return unavailableProvider(
			"claude-code",
			"Claude Code",
			"Claude usage API returned no quota windows",
			capturedAtMs,
		)
	}

	return {
		providerId: "claude-code",
		displayName: "Claude Code",
		plan: plan ?? "Claude Code",
		capturedAtMs,
		connection: "connected",
		windows,
		message,
	}
}

export const claudePlanLabel = (input: {
	readonly hasAvailableSubscription: boolean
	readonly billingType: string | null
}): string => {
	if (input.hasAvailableSubscription === false) {
		return "Claude Code"
	}
	if (input.billingType === "stripe") {
		return "Claude Pro"
	}
	return "Claude subscription"
}
