import {
	AgentEnvOverridesByAgent,
	isBlockedAgentEnvName
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

// The environment a person set for one agent in the settings dialog, on its
// way to that agent's spawn. These are credentials (API keys, proxy URLs with
// basic-auth in them), so nothing in this module ever puts a VALUE into a log
// line, an error message, or an event payload — see describeAgentEnvOverrides
// for the only diagnostic shape allowed.
export type AgentEnvOverrides = Readonly<Record<string, string>>

export const EMPTY_AGENT_ENV: AgentEnvOverrides = Object.freeze({})

const decodeByAgent = Schema.decodeUnknownExit(AgentEnvOverridesByAgent)

// A stored setting is not a trusted input. It predates the current dialog's
// own validation, and anything that can reach the settings RPC can write it,
// so the blocklist is enforced HERE, at the spawn seam, and not only in the
// dialog: PATH or NODE_OPTIONS in this map is arbitrary code execution inside
// the agent process. A blank name, or a name with an '=' in it, cannot be a
// real variable and is dropped for the same reason.
const isUsableName = (name: string): boolean =>
	Str.isNonEmpty(Str.trim(name)) &&
	name.includes("=") === false &&
	isBlockedAgentEnvName(name) === false

export const sanitizeAgentEnvOverrides = (input: AgentEnvOverrides): AgentEnvOverrides =>
	Record.filter(input, (_value, name) => isUsableName(name))

// Reads one agent's overrides out of the raw `agent_env_overrides` setting
// value, which the desktop stores as a JSON object keyed by agent id. A
// setting that never existed, or that holds something other than the expected
// shape, yields an empty map rather than an error: a malformed preference
// must not be able to stop a session from starting.
export const agentEnvOverridesFor = (
	rawSetting: string,
	agentId: string
): AgentEnvOverrides => {
	const parsed = parseJson(rawSetting)
	if (parsed === null) {
		return EMPTY_AGENT_ENV
	}
	const decoded = decodeByAgent(parsed)
	if (Exit.isFailure(decoded)) {
		return EMPTY_AGENT_ENV
	}
	const forAgent = Record.get(decoded.value, agentId)
	if (forAgent._tag === "None") {
		return EMPTY_AGENT_ENV
	}
	return sanitizeAgentEnvOverrides(forAgent.value)
}

const parseJson = (raw: string): unknown => {
	if (Str.isEmpty(Str.trim(raw))) {
		return null
	}
	try {
		return JSON.parse(raw) as unknown
	} catch {
		return null
	}
}

// Merges overrides ON TOP of an environment the child already needs. The
// child keeps every inherited variable (PATH, HOME, the provider's own auth
// files' locations); an override with the same name wins. Used wherever a
// spawn REPLACES the environment instead of extending it — the Claude SDK's
// `env` option and OpenCode's allow-listed env both do.
export const mergeAgentEnv = <A extends string | undefined>(
	base: Readonly<Record<string, A>>,
	overrides: AgentEnvOverrides
): Record<string, A | string> => ({ ...base, ...sanitizeAgentEnvOverrides(overrides) })

export const hasAgentEnvOverrides = (overrides: AgentEnvOverrides): boolean =>
	Record.size(overrides) > 0

// The ONLY shape these overrides may take in a log, a span annotation, or a
// failure detail: the variable names, never their values. A name is a label a
// person chose; a value is the credential itself.
export const describeAgentEnvOverrides = (overrides: AgentEnvOverrides): string => {
	const names = Arr.sort(Record.keys(overrides), Str.Order)
	if (Arr.isReadonlyArrayNonEmpty(names) === false) {
		return "none"
	}
	return Arr.join(names, ", ")
}
