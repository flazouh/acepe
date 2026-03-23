/**
 * Security tests for tool display content.
 * Verifies that malicious content in tool call arguments flows through
 * getToolKindSubtitle/getToolKindFilePath unchanged, so Svelte's text
 * interpolation can safely escape it (XSS protection).
 */

import { describe, expect, it } from "bun:test";
import {
	getToolKindFilePath,
	getToolKindSubtitle,
} from "../../../registry/tool-kind-ui-registry.js";
import type { ToolCall } from "../../../types/tool-call.js";

function makeThinkToolCall(description: string): ToolCall {
	return {
		id: "tool-1",
		name: "Task",
		kind: "task",
		arguments: { kind: "think", description },
		status: "pending",
		awaitingPlanApproval: false,
	};
}

function makeReadToolCall(filePath: string): ToolCall {
	return {
		id: "tool-1",
		name: "Read",
		kind: "read",
		arguments: { kind: "read", file_path: filePath },
		status: "pending",
		awaitingPlanApproval: false,
	};
}

function makeEditToolCall(filePath: string): ToolCall {
	return {
		id: "tool-1",
		name: "Edit",
		kind: "edit",
		arguments: { kind: "edit", edits: [{ filePath }] },
		status: "pending",
		awaitingPlanApproval: false,
	};
}

describe("Tool Display Security", () => {
	describe("XSS prevention in task descriptions", () => {
		it("should preserve HTML tags in task descriptions via getToolKindSubtitle (Svelte will escape them)", () => {
			const maliciousDescription = '<script>alert("xss")</script>';
			const toolCall = makeThinkToolCall(maliciousDescription);

			const content = getToolKindSubtitle("task", toolCall);

			expect(content).toBe(maliciousDescription);
			// Svelte's text interpolation {content} will escape this
		});

		it("should preserve img onerror attacks", () => {
			const maliciousDescription = '<img src=x onerror=alert("xss")>';
			const toolCall = makeThinkToolCall(maliciousDescription);

			expect(getToolKindSubtitle("think", toolCall)).toBe(maliciousDescription);
		});

		it("should preserve event handler attributes", () => {
			const maliciousDescription = "<div onclick=\"alert('xss')\">Click me</div>";
			const toolCall = makeThinkToolCall(maliciousDescription);

			expect(getToolKindSubtitle("task", toolCall)).toBe(maliciousDescription);
		});
	});

	describe("XSS prevention in file paths", () => {
		it("should preserve HTML in file paths via getToolKindFilePath", () => {
			const maliciousPath = '/path/to/<script>alert("xss")</script>.txt';
			const toolCall = makeReadToolCall(maliciousPath);

			const path = getToolKindFilePath("read", toolCall);

			expect(path).toBe(maliciousPath);
		});

		it("should preserve special characters in file paths", () => {
			const specialPath = "/path/with/&lt;brackets&gt;/and/&amp;ampersands.txt";
			const toolCall = makeEditToolCall(specialPath);

			expect(getToolKindFilePath("edit", toolCall)).toBe(specialPath);
		});
	});

	describe("Documentation of security boundary", () => {
		it("documents that XSS protection is via Svelte text interpolation", () => {
			// XSS PROTECTION STRATEGY:
			// 1. Registry preserves content as-is (getToolKindSubtitle, getToolKindFilePath)
			// 2. Queue item passes strings to Svelte templates
			// 3. Svelte uses {content} (text interpolation) - NEVER @html
			// 4. Svelte automatically escapes HTML entities
			// 5. This prevents script execution
			//
			// CRITICAL: Never use {@html content} in queue-item.svelte

			const dangerousContent = '<script>alert("xss")</script>';
			const toolCall = makeThinkToolCall(dangerousContent);

			const content = getToolKindSubtitle("task", toolCall);

			expect(content).toContain("<script>");
			// When rendered via {content} in Svelte, this becomes escaped
		});
	});
});
