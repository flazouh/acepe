import { expect, test } from "bun:test";
import { startShell } from "@acepe/electrobun-shell";

test("bun entry ping handler returns the echoed value", () => {
	const opened = startShell({
		defineRpc: (handlers) => handlers,
		openWindow: (input) => input,
	});
	expect(opened.rpc.ping({ message: "desktop round trip" })).toEqual({
		echo: "desktop round trip",
	});
});

test("bun entry window loads the svelte bundle", () => {
	const opened = startShell({
		defineRpc: (handlers) => handlers,
		openWindow: (input) => input,
	});
	expect(opened.url).toBe("views://mainview/index.html");
	expect(opened.title).toBe("Acepe");
});
