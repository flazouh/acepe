import { expect, test } from "bun:test";
import { startAcepeShell } from "@acepe/electrobun-shell";

test("bun entry ping handler returns the echoed value", () => {
	const opened = startAcepeShell(
		{
			defineRpc: (handlers) => handlers,
			openWindow: (input) => input,
		},
		{
			dispatch: (params) => params,
			snapshot: (params) => params,
			events: (params) => params,
			getProjectIndex: (params) => params,
			invalidateProjectIndex: (params) => params,
		},
	);
	expect(opened.rpc.ping({ message: "desktop round trip" })).toEqual({
		echo: "desktop round trip",
	});
});

test("bun entry window loads the svelte bundle and exposes acepe rpc", () => {
	const opened = startAcepeShell(
		{
			defineRpc: (handlers) => handlers,
			openWindow: (input) => input,
		},
		{
			dispatch: () => ({ sequence: 1 }),
			snapshot: () => ({ snapshotSequence: 0 }),
			events: () => undefined,
			getProjectIndex: () => ({ totalFiles: 0 }),
			invalidateProjectIndex: () => undefined,
		},
	);
	expect(opened.url).toBe("views://mainview/index.html");
	expect(opened.title).toBe("Acepe");
	expect(opened.rpc.dispatch({ type: "project.create" })).toEqual({ sequence: 1 });
});
