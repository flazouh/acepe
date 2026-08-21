import * as Option from "effect/Option"
import * as Str from "effect/String"

export const parseMcpSlashServerName = (commandName: string): Option.Option<string> => {
	if (Str.startsWith("mcp:")(commandName) === false) {
		return Option.none()
	}
	const remainder = commandName.slice("mcp:".length)
	if (remainder.length === 0) {
		return Option.none()
	}
	const serverName = Str.trim(Str.split(remainder, ":")[0] ?? remainder)
	if (serverName.length === 0) {
		return Option.none()
	}
	return Option.some(serverName)
}

export const isMcpSlashCommand = (commandName: string): boolean =>
	Option.isSome(parseMcpSlashServerName(commandName))
