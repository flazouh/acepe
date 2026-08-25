// acepe#261 diagnostic: Electrobun's bun->webview push has two transport
// fallbacks (an encrypted WebSocket, then executeJavascript), and both
// silently drop a payload that JSON.stringify can't serialize (a thrown
// error, or the "undefined" JSON.stringify itself returns for values like
// bare `undefined`, functions, or symbols). Neither failure surfaces back to
// the bun-side caller. This lets a push call site log, before it ever leaves
// bun, whether the payload it is about to hand to sendEvents would actually
// survive that serialization.
export type JsonSafety = {
	readonly jsonSafe: boolean
	readonly jsonLength: number
}

export const describeJsonSafety = (value: unknown): JsonSafety => {
	try {
		const json = JSON.stringify(value)
		if (json === undefined) {
			return { jsonSafe: false, jsonLength: -1 }
		}
		return { jsonSafe: true, jsonLength: json.length }
	} catch {
		return { jsonSafe: false, jsonLength: -1 }
	}
}
