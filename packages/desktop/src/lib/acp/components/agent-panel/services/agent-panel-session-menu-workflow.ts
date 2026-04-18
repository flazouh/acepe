/**
 * Session menu actions: clipboard, Finder, raw log, Acepe file panel — async side effects for agent panel.
 */

import { ResultAsync } from "neverthrow";
import { toast } from "svelte-sonner";
import type { SessionCold, SessionEntry } from "../../../application/dto/session";
import { openFileInEditor } from "$lib/utils/tauri-client/opener.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import { createLogger } from "../../../utils/logger.js";
import { copySessionToClipboard, copyTextToClipboard } from "../logic/clipboard-manager.js";
import { getOpenInFinderTarget } from "../logic/open-in-finder-target.js";
import { sessionEntriesToMarkdown } from "../../../utils/session-to-markdown.js";

type Logger = ReturnType<typeof createLogger>;

type ClipboardSessionPayload = SessionCold & {
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly entryCount: number;
};

export async function copyThreadContentToClipboard(args: {
	sessionId: string;
	getSessionCold: (id: string) => SessionCold | null | undefined;
	getEntries: (id: string) => SessionEntry[];
}): Promise<void> {
	const { sessionId, getSessionCold, getEntries } = args;
	const cold = getSessionCold(sessionId);
	if (!cold) {
		toast.error("No thread to copy");
		return;
	}
	const entries = getEntries(sessionId);
	const payload: ClipboardSessionPayload = { ...cold, entries, entryCount: entries.length };
	await copySessionToClipboard(payload).match(
		() => toast.success("Thread content copied to clipboard"),
		() => toast.error("Failed to copy thread content")
	);
}

export async function openSessionInFinder(args: {
	sessionId: string | null;
	projectPath: string | null | undefined;
	agentId: string | null | undefined;
	sourcePath: string | null | undefined;
}): Promise<void> {
	const target = getOpenInFinderTarget({
		sessionId: args.sessionId,
		projectPath: args.projectPath,
		agentId: args.agentId,
		sourcePath: args.sourcePath,
	});

	if (!target) {
		toast.error("No thread to open");
		return;
	}

	if (target.kind === "reveal") {
		await revealInFinder(target.path).mapErr(() => toast.error("Failed to open thread in Finder"));
		return;
	}

	await tauriClient.shell
		.openInFinder(target.sessionId, target.projectPath)
		.mapErr(() => toast.error("Failed to open thread in Finder"));
}

export async function openStreamingLog(sessionId: string | null): Promise<void> {
	if (!sessionId) {
		toast.error("No thread to export");
		return;
	}

	await tauriClient.shell.openStreamingLog(sessionId).match(
		() => undefined,
		(error) => toast.error(`Failed to open streaming log: ${error.message}`)
	);
}

export async function copyStreamingLogPathToClipboard(args: {
	sessionId: string | null;
	logger: Logger;
}): Promise<void> {
	const { sessionId, logger } = args;
	if (!sessionId) {
		logger.warn("copyStreamingLogPathToClipboard: no session id");
		toast.error("No thread to export");
		return;
	}

	logger.info("copyStreamingLogPathToClipboard: requesting streaming log path", { sessionId });

	await tauriClient.shell
		.getStreamingLogPath(sessionId)
		.andThen((path) => {
			logger.info("copyStreamingLogPathToClipboard: received streaming log path", {
				sessionId,
				path,
			});

			return copyTextToClipboard(path);
		})
		.match(
			() => {
				logger.info("copyStreamingLogPathToClipboard: copy succeeded", { sessionId });
				toast.success("Path copied to clipboard");
			},
			(error) => {
				logger.error("copyStreamingLogPathToClipboard: copy failed", {
					sessionId,
					error: error.message,
				});
				toast.error("Failed to copy path");
			}
		);
}

export async function openSessionRawFileInEditor(args: {
	sessionId: string | null;
	sessionProjectPath: string | null | undefined;
}): Promise<void> {
	const { sessionId, sessionProjectPath } = args;
	if (!sessionId || !sessionProjectPath) return;
	await tauriClient.shell
		.getSessionFilePath(sessionId, sessionProjectPath)
		.andThen((path) => openFileInEditor(path))
		.match(
			() => toast.success("Opened streaming log in file manager"),
			(err) => toast.error(`Failed to open session file: ${err.message}`)
		);
}

export async function openSessionFileInAcepePanel(args: {
	sessionId: string | null;
	sessionProjectPath: string | null | undefined;
	effectivePanelId: string | undefined;
	openFilePanel: (
		fileName: string,
		dirPath: string,
		opts: { ownerPanelId: string | undefined }
	) => void;
}): Promise<void> {
	const { sessionId, sessionProjectPath, effectivePanelId, openFilePanel } = args;
	if (!sessionId || !sessionProjectPath) return;
	await tauriClient.shell.getSessionFilePath(sessionId, sessionProjectPath).match(
		(fullPath) => {
			const parts = fullPath.split(/[/\\]/);
			const fileName = parts.pop() ?? fullPath;
			const dirPath = parts.join("/") || "/";
			openFilePanel(fileName, dirPath, { ownerPanelId: effectivePanelId });
		},
		(err) => toast.error(`Failed to open session file: ${err.message}`)
	);
}

export async function exportSessionMarkdownToClipboard(entries: ReadonlyArray<SessionEntry>): Promise<void> {
	const markdown = sessionEntriesToMarkdown(entries);
	await ResultAsync.fromPromise(navigator.clipboard.writeText(markdown), (e) => new Error(String(e))).match(
		() => toast.success("Copied to clipboard"),
		(err) => toast.error(`Failed to export: ${err.message}`)
	);
}

export async function exportSessionJsonToClipboard(args: {
	sessionId: string;
	getSessionCold: (id: string) => SessionCold | null | undefined;
	getEntries: (id: string) => SessionEntry[];
}): Promise<void> {
	const { sessionId, getSessionCold, getEntries } = args;
	const cold = getSessionCold(sessionId);
	if (!cold) {
		toast.error(`Failed to export: ${"Session not found"}`);
		return;
	}
	const entries = getEntries(sessionId);
	const payload: ClipboardSessionPayload = { ...cold, entries, entryCount: entries.length };
	copySessionToClipboard(payload).match(
		() => toast.success("Copied to clipboard"),
		(err) => toast.error(`Failed to export: ${err.message}`)
	);
}
