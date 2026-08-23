<script lang="ts">
import { type ProjectedTerminal, type RpcClient, type SessionId } from "@acepe/contracts";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { onDestroy, onMount } from "svelte";

import { useTheme } from "$lib/components/theme/context.svelte.js";
import { resolveTerminalTheme } from "$lib/acp/components/terminal-panel/terminal-theme.ts";
import {
	closeTerminalCommand,
	followTerminal,
	inputTerminalCommand,
	nextTerminalId,
	openTerminalCommand,
	resizeTerminalCommand,
} from "./agent-panel-terminal-store.ts";

interface Props {
	client: RpcClient;
	sessionId: SessionId;
	cwd?: string;
}

// No project workspace root is threaded down to the session view yet (the
// Electrobun scaffold doesn't carry it here), so this defaults to a
// directory guaranteed to exist. Real project-cwd wiring is follow-up work.
const DEFAULT_CWD = "/tmp";

let { client, sessionId, cwd = DEFAULT_CWD }: Props = $props();

const themeState = useTheme();
const terminalId = nextTerminalId();

let containerEl: HTMLDivElement | undefined = $state();
let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let pollFiber: Fiber.Fiber<void, never> | undefined;
let active = true;
let renderedLength = 0;
let lastOutputText = $state("");
let closed = $state(false);
let lastError = $state<string | null>(null);

const terminalTheme = $derived.by(() => {
	const mode = themeState.effectiveTheme === "dark" ? "dark" : "light";
	return resolveTerminalTheme(mode, (name) => {
		if (typeof window === "undefined") {
			return null;
		}
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return value.length > 0 ? value : null;
	});
});

$effect(() => {
	if (terminal !== undefined) {
		terminal.options.theme = terminalTheme;
	}
});

const renderSnapshot = (snap: ProjectedTerminal | null) => {
	if (snap === null || terminal === undefined) {
		return;
	}
	lastOutputText = snap.output;
	closed = snap.closed;
	if (snap.output.length < renderedLength) {
		// The server-side ring buffer dropped the front (TERMINAL_OUTPUT_CAP):
		// there is no valid delta, so redraw from scratch.
		terminal.reset();
		terminal.write(snap.output);
		renderedLength = snap.output.length;
		return;
	}
	const delta = snap.output.slice(renderedLength);
	if (delta.length > 0) {
		terminal.write(delta);
		renderedLength = snap.output.length;
	}
};

const reportError = (cause: unknown) => {
	lastError = String(cause).slice(0, 300);
};

const dispatchResize = (cols: number, rows: number) => {
	Effect.runFork(client.dispatch(resizeTerminalCommand(terminalId, cols, rows)));
};

onMount(() => {
	if (containerEl === undefined) {
		return;
	}
	terminal = new Terminal({
		cursorBlink: true,
		cursorStyle: "bar",
		fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
		fontSize: 13,
		lineHeight: 1.2,
		theme: terminalTheme,
		allowProposedApi: true,
	});
	fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.open(containerEl);
	requestAnimationFrame(() => {
		fitAddon?.fit();
	});

	terminal.onData((data: string) => {
		const command = inputTerminalCommand(terminalId, data);
		if (command === null) {
			return;
		}
		Effect.runFork(
			client.dispatch(command).pipe(Effect.tapCause((cause) => Effect.sync(() => reportError(cause))))
		);
	});

	pollFiber = Effect.runFork(
		client.dispatch(openTerminalCommand({ terminalId, sessionId, cwd })).pipe(
			Effect.andThen(
				followTerminal({
					client,
					terminalId,
					isActive: () => active,
					onSnapshot: renderSnapshot,
				})
			),
			Effect.tapCause((cause) => Effect.sync(() => reportError(cause)))
		)
	);

	resizeObserver = new ResizeObserver(() => {
		requestAnimationFrame(() => {
			if (fitAddon === undefined || terminal === undefined) {
				return;
			}
			fitAddon.fit();
			dispatchResize(terminal.cols, terminal.rows);
		});
	});
	resizeObserver.observe(containerEl);
});

onDestroy(() => {
	active = false;
	resizeObserver?.disconnect();
	if (pollFiber !== undefined) {
		Effect.runFork(Fiber.interrupt(pollFiber));
	}
	Effect.runFork(client.dispatch(closeTerminalCommand(terminalId)));
	terminal?.dispose();
});
</script>

<div
	class="h-full w-full terminal-container"
	data-testid="terminal-view"
	data-qa-terminal-id={terminalId}
	data-qa-terminal-closed={closed}
	data-qa-terminal-error={lastError ?? ""}
>
	<div bind:this={containerEl} class="h-full w-full"></div>
	<!-- Plain-text mirror of the same output xterm renders, kept in the DOM
	     for automation that greps text rather than reading the xterm canvas. -->
	<pre data-qa="terminal-output-text" class="sr-only">{lastOutputText}</pre>
</div>

<style>
	.terminal-container :global(.xterm) {
		height: 100%;
		padding: 8px;
	}

	.terminal-container :global(.xterm-viewport) {
		overflow-y: auto !important;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: pre-wrap;
		border: 0;
	}
</style>
