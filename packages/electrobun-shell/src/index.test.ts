import { expect, test } from "bun:test"

import { pingRequestHandler, startShell } from "./index.ts"

test("package entry exposes the webview to bun round trip", () => {
	const opened = startShell({
		defineRpc: (handlers) => handlers,
		openWindow: (input) => input,
	})
	expect(opened.rpc.ping({ message: "from index" })).toEqual({ echo: "from index" })
	expect(pingRequestHandler({ message: "from index" })).toEqual({ echo: "from index" })
})
