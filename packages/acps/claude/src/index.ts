#!/usr/bin/env node

/**
 * Acepe adapter for @zed-industries/claude-agent-acp
 *
 * Extends the upstream ClaudeAcpAgent with Acepe-specific behavior:
 * 1. Attachment token expansion (@[text:BASE64] → decoded content)
 * 2. acceptEdits mode auto-approval for edit tools
 * 3. macOS TCC tool blocking
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

const TCC_SENSITIVE_TOOLS = new Set([
	"mcp__acepe-mcp__take_screenshot",
	"mcp__acepe-mcp__simulate_mouse_movement",
	"mcp__acepe-mcp__simulate_text_input",
	"mcp__acepe-mcp__execute_js",
	"mcp__acepe-mcp__get_element_position",
	"mcp__acepe-mcp__send_text_to_element",
	"mcp__acepe-mcp__manage_window",
]);

function shouldBlockMacOsTccTool(toolName: string): boolean {
	if (process.platform !== "darwin") {
		return false;
	}
	if (process.env.ACEPE_ALLOW_TCC_AUTOMATION_TOOLS === "1") {
		return false;
	}
	return TCC_SENSITIVE_TOOLS.has(toolName);
}

// --- Acepe Agent ---

class AcepeAcpAgent extends ClaudeAcpAgent {
	/**
	 * Override prompt() to expand attachment tokens before sending to Claude.
	 * Tokens like @[text:BASE64] are decoded into <pasted-content> blocks.
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
	 * - macOS TCC blocking: deny automation tools that trigger TCC prompts
	 */
	canUseTool(sessionId: string): CanUseTool {
		const parentCanUseTool = super.canUseTool(sessionId);

		return async (toolName, toolInput, context) => {
			// Block macOS TCC-sensitive tools
			if (shouldBlockMacOsTccTool(toolName)) {
				return {
					behavior: "deny" as const,
					message:
						"This tool requires macOS accessibility permissions. Set ACEPE_ALLOW_TCC_AUTOMATION_TOOLS=1 to enable.",
				};
			}

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
