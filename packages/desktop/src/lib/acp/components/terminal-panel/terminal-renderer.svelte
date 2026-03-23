<script lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import { type IPty, spawn } from "tauri-pty";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import "xterm/css/xterm.css";
import { Terminal } from "xterm";

import { resolveTerminalTheme } from "./terminal-theme.js";

interface Props {
	projectPath: string;
	shell: string;
	onPtyCreated: (ptyId: number) => void;
	onPtyError: (error: string) => void;
}

let { projectPath, shell, onPtyCreated, onPtyError }: Props = $props();

const themeState = useTheme();

let terminalContainer: HTMLDivElement | undefined = $state();
let terminal: Terminal | undefined = $state();
let fitAddon: FitAddon | undefined;
let pty: IPty | undefined;
let resizeObserver: ResizeObserver | undefined;

function readCssVariable(name: string): string | null {
	if (typeof window === "undefined") return null;
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value.length > 0 ? value : null;
}

// Terminal theme follows the same panel palette used by the agent panel.
const terminalTheme = $derived.by(() => {
	const mode = themeState.effectiveTheme === "dark" ? "dark" : "light";
	return resolveTerminalTheme(mode, readCssVariable);
});

// Update terminal theme when app theme changes
$effect(() => {
	if (terminal) {
		terminal.options.theme = terminalTheme;
	}
});

onMount(async () => {
	if (!terminalContainer) return;

	// Initialize xterm.js
	terminal = new Terminal({
		cursorBlink: true,
		cursorStyle: "bar",
		fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
		fontSize: 13,
		lineHeight: 1.2,
		theme: terminalTheme,
		allowProposedApi: true,
	});

	fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.loadAddon(new WebLinksAddon());

	terminal.open(terminalContainer);

	// Wait for next frame to ensure container has dimensions
	await new Promise((resolve) => requestAnimationFrame(resolve));
	fitAddon.fit();

	// Spawn PTY process
	await ResultAsync.fromPromise(
		Promise.resolve(
			spawn(shell, [], {
				cols: terminal.cols,
				rows: terminal.rows,
				cwd: projectPath,
				env: { TERM: "xterm-256color" },
			})
		),
		(error) => (error instanceof Error ? error.message : String(error))
	).match(
		(ptyInstance: IPty) => {
			pty = ptyInstance;
			onPtyCreated(pty.pid);

			// Wire up I/O
			pty.onData((data: Uint8Array) => {
				terminal?.write(data);
			});

			pty.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
				terminal?.write(`\r\n[Process exited with code ${exitCode}]\r\n`);
			});

			terminal?.onData((data: string) => {
				pty?.write(data);
			});
		},
		(message: string) => {
			onPtyError(message);
			terminal?.write(`\r\n[Failed to spawn shell: ${message}]\r\n`);
		}
	);

	// Handle resize
	resizeObserver = new ResizeObserver(() => {
		// Debounce resize to avoid excessive calls
		requestAnimationFrame(() => {
			if (fitAddon && terminal) {
				fitAddon.fit();
				if (pty) {
					pty.resize(terminal.cols, terminal.rows);
				}
			}
		});
	});
	resizeObserver.observe(terminalContainer);
});

onDestroy(() => {
	resizeObserver?.disconnect();
	pty?.kill();
	terminal?.dispose();
});
</script>

<div bind:this={terminalContainer} class="h-full w-full terminal-container"></div>

<style>
	.terminal-container :global(.xterm) {
		height: 100%;
		padding: 8px;
	}

	.terminal-container :global(.xterm-viewport) {
		overflow-y: auto !important;
	}
</style>
