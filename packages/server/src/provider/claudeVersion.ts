import * as Option from "effect/Option"
import * as Str from "effect/String"

const WHITESPACE = /\s+/

export const parseClaudeVersion = (stdout: string): Option.Option<string> => {
	const trimmed = Str.trim(stdout)
	if (Str.isEmpty(trimmed)) {
		return Option.none()
	}
	const token = trimmed.split(WHITESPACE)[0]
	if (token === undefined || Str.isEmpty(token)) {
		return Option.none()
	}
	return Option.some(token)
}
