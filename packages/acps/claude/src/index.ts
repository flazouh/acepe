#!/usr/bin/env node

/**
 * Acepe adapter for @zed-industries/claude-agent-acp
 *
 * Extends the upstream ClaudeAcpAgent with Acepe-specific behavior:
 * 1. acceptEdits mode auto-approval for edit tools
 *
 * Note: Attachment token expansion (@[text:BASE64] → <pasted-content>) is handled
 * in the Rust Tauri layer (attachment_token_expander.rs) before prompts reach any
 * backend. Tokens arrive here already expanded.
 */

import {
	AgentSideConnection,
	ndJsonStream,
	type PromptRequest,
	type PromptResponse,
} from "@agentclientprotocol/sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import {
	applyEnvironmentSettings,
	ClaudeAcpAgent,
	loadManagedSettings,
	nodeToWebReadable,
	nodeToWebWritable,
} from "@zed-industries/claude-agent-acp";
import { expandAttachmentTokens, hasAttachmentTokens } from "./attachment-token-parser.js";
import {
	collectStartupFailureContext,
	logStartupFailure,
	type StartupFailure,
} from "./startup-diagnostics.js";
import { finalizePermissionResult } from "./permission-result.js";

const EDIT_TOOL_NAMES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// --- Acepe Agent ---

class AcepeAcpAgent extends ClaudeAcpAgent {
	/**
	 * Override prompt() to expand attachment tokens before sending to Claude.
	 * Note: @[text:BASE64] tokens are already expanded to <pasted-content> blocks
	 * by the Rust Tauri layer. This handles remaining token types (@[file:], @[image:],
	 * @[command:], @[skill:]) and serves as a safety net for @[text:] if Rust expansion
	 * is bypassed.
	 */
	async prompt(params: PromptRequest): Promise<PromptResponse> {
		for (const chunk of params.prompt) {
			if (chunk.type === "text" && hasAttachmentTokens(chunk.text)) {
				chunk.text = expandAttachmentTokens(chunk.text).expandedText;
			}
		}
		return super.prompt(params);
	}

	/**
	 * Override canUseTool() to add:
	 * - acceptEdits mode: auto-approve edit tools without user confirmation
	 */
	canUseTool(sessionId: string): CanUseTool {
		const parentCanUseTool = super.canUseTool(sessionId);

		return async (toolName, toolInput, context) => {
			// acceptEdits mode: auto-approve edit tools
			const session = this.sessions[sessionId];
			if (session?.permissionMode === "acceptEdits" && EDIT_TOOL_NAMES.has(toolName)) {
				return {
					behavior: "allow" as const,
					updatedInput: toolInput,
				};
			}

			const result = await parentCanUseTool(toolName, toolInput, context);
			return finalizePermissionResult(result, toolName, this.sessions[sessionId]?.permissionMode);
		};
	}
}

// --- Entry Point ---

// stdout is used for JSON-RPC; redirect console to stderr
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

let startupStage = "bootstrap";

function logIndexStartupFailure(failure: StartupFailure): void {
	logStartupFailure(collectStartupFailureContext("index", "acp", startupStage), failure);
}

process.on("uncaughtException", (error) => {
	logIndexStartupFailure(error);
	process.exit(1);
});

process.on("unhandledRejection", (reason: StartupFailure) => {
	logIndexStartupFailure(reason);
	process.exit(1);
});

async function startAcepeAcp(): Promise<void> {
	startupStage = "load-managed-settings";
	const managedSettings = loadManagedSettings();
	if (managedSettings) {
		startupStage = "apply-managed-settings";
		applyEnvironmentSettings(managedSettings);
	}

	startupStage = "create-json-rpc-stream";
	const input = nodeToWebWritable(process.stdout);
	const output = nodeToWebReadable(process.stdin);
	const stream = ndJsonStream(input, output);

	startupStage = "create-agent-connection";
	new AgentSideConnection((client) => new AcepeAcpAgent(client), stream);

	startupStage = "wait-for-stdin-close";
	process.stdin.resume();
	process.stdin.on("end", () => process.exit(0));
}

await startAcepeAcp().catch((error: StartupFailure) => {
	logIndexStartupFailure(error);
	process.exit(1);
});
