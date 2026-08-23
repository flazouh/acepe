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
import { TerminalViewController } from "./agent-panel-terminal-view-controller.svelte.ts";

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

const controller = new TerminalViewController();

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
	const instruction = controller.applySnapshot(snap);
	if (instruction === null || terminal === undefined) {
		return;
	}
	if (instruction.kind === "reset") {
		terminal.reset();
	}
	terminal.write(instruction.text);
};

const dispatchResize = (cols: number, rows: number) => {
	Effect.runFork(client.dispatch(resizeTerminalCommand(terminalId, cols, rows)));
};

// Dispatches one or more raw input payloads to the server in order, tapping
// success to clear a stale error (defect 3) and failure to report a new one.
// Used both for direct keystrokes and for flushing input buffered while
// `terminal.open` was still in flight (defect 1).
const dispatchInputData = (payloads: readonly string[]) => {
	if (payloads.length === 0) {
		return;
	}
	Effect.runFork(
		Effect.forEach(
			payloads,
			(data) => {
				const command = inputTerminalCommand(terminalId, data);
				if (command === null) {
					return Effect.void;
				}
				return client.dispatch(command).pipe(
					Effect.tap(() => Effect.sync(() => controller.markInputSucceeded())),
					Effect.tapCause((cause) => Effect.sync(() => controller.reportError(cause)))
				);
			},
			{ discard: true }
		)
	);
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
		dispatchInputData(controller.submitInput(data));
	});

	pollFiber = Effect.runFork(
		client.dispatch(openTerminalCommand({ terminalId, sessionId, cwd })).pipe(
			// Once open has round-tripped, flush anything buffered while it was
			// in flight (defect 1) before treating later keystrokes as immediate.
			Effect.tap(() => Effect.sync(() => dispatchInputData(controller.markOpenReady()))),
			Effect.andThen(
				followTerminal({
					client,
					terminalId,
					isActive: () => active,
					onSnapshot: renderSnapshot,
				})
			),
			Effect.tapCause((cause) => Effect.sync(() => controller.reportError(cause)))
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
	data-qa-terminal-closed={controller.closed}
	data-qa-terminal-error={controller.lastError ?? ""}
>
	<div bind:this={containerEl} class="h-full w-full"></div>
	<!-- Plain-text mirror of the same output xterm renders, kept in the DOM
	     for automation that greps text rather than reading the xterm canvas. -->
	<pre data-qa="terminal-output-text" class="sr-only">{controller.lastOutputText}</pre>
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
