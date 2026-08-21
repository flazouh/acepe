import { RPC_ROUNDTRIP_MESSAGE, RPC_ROUNDTRIP_PREFIX } from "./ping.ts"

export const parseRpcRoundtripEcho = (line: string): string | null => {
	const prefix = `${RPC_ROUNDTRIP_PREFIX}: `
	if (line.startsWith(prefix) === false) {
		return null
	}
	const echo = line.slice(prefix.length)
	if (echo.length === 0) {
		return null
	}
	return echo
}

export const parseSystemEventsProcessNames = (stdout: string): ReadonlyArray<string> => {
	const trimmed = stdout.trim()
	if (trimmed.length === 0) {
		return []
	}
	const names: Array<string> = []
	for (const part of trimmed.split(",")) {
		const name = part.trim()
		if (name.length > 0) {
			names.push(name)
		}
	}
	return names
}

export const visibleProcessListContainsAcepe = (names: ReadonlyArray<string>): boolean => {
	for (const name of names) {
		if (name === "Acepe" || name === "launcher") {
			return true
		}
	}
	return false
}

export type LiveWindowProof = {
	readonly echo: string | null
	readonly acepeVisible: boolean
	readonly passed: boolean
}

export const judgeLiveWindowProof = (input: {
	readonly logText: string
	readonly processListStdout: string
}): LiveWindowProof => {
	const lines = input.logText.split("\n")
	let echo: string | null = null
	for (const line of lines) {
		const parsed = parseRpcRoundtripEcho(line.trim())
		if (parsed !== null) {
			echo = parsed
		}
	}
	const acepeVisible = visibleProcessListContainsAcepe(
		parseSystemEventsProcessNames(input.processListStdout),
	)
	return {
		echo,
		acepeVisible,
		passed: echo === RPC_ROUNDTRIP_MESSAGE && acepeVisible === true,
	}
}
