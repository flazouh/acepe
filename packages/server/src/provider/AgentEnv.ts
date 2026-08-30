import {
	type AgentEnvOverrides,
	AgentEnvOverridesByAgent,
	isBlockedAgentEnvName
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"

// The environment a person set for one agent in the settings dialog, on its
// way to that agent's spawn. AgentEnvOverrides itself is the contract type.
//
// These are credentials (API keys, proxy URLs with basic-auth in them), so
// nothing in this module ever puts a VALUE into a log line, an error message,
// or an event payload — describeAgentEnvOverrides is the only diagnostic
// shape allowed. Every route from a stored setting to a real child process
// goes through one of the two primitives at the bottom of this file
// (agentChildProcess, mergeAgentEnv), and both sanitize, so the enforcement
// point does not depend on any caller remembering to do it.
export type { AgentEnvOverrides }

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
	name.includes("\u0000") === false &&
	isBlockedAgentEnvName(name) === false

// A NUL byte is the one thing a spawn rejects OUTRIGHT, and both Node and Bun
// quote the offending value back in the error they throw. That error becomes
// a ProviderSessionFailed detail, which is a durable event on disk and a
// string the UI shows, so a credential with a stray NUL in it would leak by
// way of a crash message. Dropping the entry keeps the value out of every
// path that could print it.
const isUsableValue = (value: string): boolean => value.includes("\u0000") === false

export const sanitizeAgentEnvOverrides = (input: AgentEnvOverrides): AgentEnvOverrides =>
	Record.filter(input, (value, name) => isUsableName(name) && isUsableValue(value))

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

// The one spawn shape every CLI-backed provider uses. Codex, Copilot and
// Cursor had three copies of it, which meant three places that had to
// remember extendEnv (without it the child loses PATH and never starts) and
// three places a future edit could skip the sanitize. extendEnv:true is what
// makes this a MERGE: the child keeps everything Acepe itself inherited, and
// an override only wins on a name collision.
export const agentChildProcess = (
	command: string,
	args: ReadonlyArray<string>,
	options: {
		readonly cwd?: string
		readonly envOverrides: AgentEnvOverrides
	}
): ChildProcess.Command =>
	ChildProcess.make(command, Arr.fromIterable(args), {
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		env: sanitizeAgentEnvOverrides(options.envOverrides),
		extendEnv: true,
		detached: false
	})
