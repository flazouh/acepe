import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as Str from "effect/String"

export const SHELL_ENV_CAPTURE_MARKER = "__ACEPE_ENV_START__\0"
export const SHELL_ENV_CAPTURE_COMMAND = "printf '__ACEPE_ENV_START__\\0'; env -0"
export const SHELL_ENV_CAPTURE_TIMEOUT_SECONDS = 5
export const DEFAULT_UNIX_SHELL = "/bin/sh"
export const DEFAULT_CAPTURE_SHELL = "/bin/zsh"
export const DEFAULT_WINDOWS_SHELL = "cmd.exe"
export const DEFAULT_TERM = "xterm-256color"
export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24

const ENV_KEY = /^[A-Za-z0-9_]+$/

export type EnvMap = Rec.ReadonlyRecord<string, string>

export type EnvVariable = {
	readonly name: string
	readonly value: string
}

export type SpawnTarget = {
	readonly file: string
	readonly args: ReadonlyArray<string>
}

export const shellFileName = (shellPath: string): string => {
	const unix = shellPath.lastIndexOf("/")
	const win = shellPath.lastIndexOf("\\")
	const index = unix > win ? unix : win
	if (index < 0) {
		return shellPath
	}
	return shellPath.slice(index + 1)
}

export const isZshShellName = (fileName: string): boolean => fileName.toLowerCase() === "zsh"

export const shellCaptureArgs = (shellPath: string): readonly [string, string] =>
	isZshShellName(shellFileName(shellPath)) === true
		? ["-ilc", SHELL_ENV_CAPTURE_COMMAND]
		: ["-lc", SHELL_ENV_CAPTURE_COMMAND]

export const defaultShell = (comspec: Option.Option<string>, shell: Option.Option<string>): string => {
	if (Option.isSome(comspec)) {
		return comspec.value
	}
	return Option.getOrElse(shell, () => DEFAULT_UNIX_SHELL)
}

export const defaultCaptureShell = (shell: Option.Option<string>): string =>
	Option.getOrElse(shell, () => DEFAULT_CAPTURE_SHELL)

export const isWindowsHost = (comspec: Option.Option<string>): boolean => Option.isSome(comspec)

export const commandSpawnTarget = (windows: boolean, command: string): SpawnTarget =>
	windows === true
		? {
				file: DEFAULT_WINDOWS_SHELL,
				args: ["/C", command]
			}
		: {
				file: DEFAULT_UNIX_SHELL,
				args: ["-c", command]
			}

export const interactiveSpawnTarget = (shell: string): SpawnTarget => ({
	file: shell,
	args: Arr.empty()
})

export const shellEnvPayload = (output: string): string => {
	const index = output.indexOf(SHELL_ENV_CAPTURE_MARKER)
	if (index < 0) {
		return output
	}
	return output.slice(index + SHELL_ENV_CAPTURE_MARKER.length)
}

const isEnvKey = (key: string): boolean => Str.isNonEmpty(key) && ENV_KEY.test(key)

export const parseEnvOutput = (bytes: string): EnvMap => {
	const entries = bytes.split("\0")
	let env = Rec.empty<string, string>()
	for (const entry of entries) {
		if (Str.isEmpty(entry)) {
			continue
		}
		const splitAt = entry.indexOf("=")
		if (splitAt <= 0) {
			continue
		}
		const key = entry.slice(0, splitAt)
		if (isEnvKey(key) === false) {
			continue
		}
		env = Rec.set(env, key, entry.slice(splitAt + 1))
	}
	return env
}

export const buildTerminalEnv = (input: {
	readonly loginEnv: EnvMap
	readonly requestEnv: ReadonlyArray<EnvVariable>
	readonly pathFallback: string
	readonly term: string
}): EnvMap => {
	let env = input.loginEnv
	if (Option.isNone(Rec.get(env, "PATH"))) {
		env = Rec.set(env, "PATH", input.pathFallback)
	}
	if (Option.isNone(Rec.get(env, "TERM"))) {
		env = Rec.set(env, "TERM", input.term)
	}
	for (const variable of input.requestEnv) {
		env = Rec.set(env, variable.name, variable.value)
	}
	return env
}

export const envMapToRecord = (env: EnvMap): { [key: string]: string } => {
	const record: { [key: string]: string } = {}
	for (const [key, value] of Rec.toEntries(env)) {
		record[key] = value
	}
	return record
}

export const enforceOutputLimit = (
	buf: string,
	maxBytes: number
): { readonly text: string; readonly truncated: boolean } => {
	if (buf.length <= maxBytes) {
		return {
			text: buf,
			truncated: false
		}
	}
	let start = buf.length - maxBytes
	while (start < buf.length && isUtf16SurrogateTail(buf, start) === true) {
		start = start + 1
	}
	return {
		text: buf.slice(start),
		truncated: true
	}
}

const isUtf16SurrogateTail = (buf: string, index: number): boolean => {
	const code = buf.charCodeAt(index)
	return code >= 0xdc00 && code <= 0xdfff
}
