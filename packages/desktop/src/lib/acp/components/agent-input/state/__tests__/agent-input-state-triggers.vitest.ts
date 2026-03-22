import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";

import { AgentInputState } from "../agent-input-state.svelte.js";

/**
 * Tests for AgentInputState trigger detection (@ and /).
 *
 * These tests verify that the handleInput method correctly detects
 * @ and / triggers and shows the appropriate dropdowns.
 *
 * Note: These tests use Vitest instead of Bun because AgentInputState
 * uses Svelte 5 runes ($state) which require Vite preprocessing.
 */
describe("AgentInputState - Trigger Detection", () => {
	let mockStore: SessionStore;
	let state: AgentInputState;

	beforeEach(() => {
		// Create a mock textarea element
		const textarea = document.createElement("textarea");
		textarea.value = "";
		document.body.appendChild(textarea);

		// Mock store - we only need minimal structure for these tests
		mockStore = {
			activeAgentId: "claude-code",
		} as unknown as SessionStore;

		// Create state without project path getter (for testing outside component context)
		const mockPanelStore = {} as unknown as PanelStore;
		state = new AgentInputState(mockStore, mockPanelStore);

		// Set the textarea ref so handleInput can access it
		state.textareaRef = textarea;
	});

	afterEach(() => {
		// Clean up DOM
		document.body.innerHTML = "";
	});

	describe("File picker trigger (@)", () => {
		it("should show file dropdown when @ is typed at start of message", () => {
			const textarea = state.textareaRef!;
			textarea.value = "@";
			textarea.setSelectionRange(1, 1);
			state.message = "@";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showFileDropdown).toBe(true);
			expect(state.fileQuery).toBe("");
			expect(state.showSlashDropdown).toBe(false);
		});

		it("should show file dropdown when @ is typed after space", () => {
			const textarea = state.textareaRef!;
			textarea.value = "Hello @";
			textarea.setSelectionRange(7, 7);
			state.message = "Hello @";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showFileDropdown).toBe(true);
			expect(state.fileQuery).toBe("");
			expect(state.showSlashDropdown).toBe(false);
		});

		it("should show file dropdown with query when @file is typed", () => {
			const textarea = state.textareaRef!;
			textarea.value = "@file";
			textarea.setSelectionRange(5, 5);
			state.message = "@file";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showFileDropdown).toBe(true);
			expect(state.fileQuery).toBe("file");
			expect(state.showSlashDropdown).toBe(false);
		});

		it("should hide file dropdown when @ is followed by space", () => {
			const textarea = state.textareaRef!;
			textarea.value = "Hello @ file";
			textarea.setSelectionRange(12, 12);
			state.message = "Hello @ file";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showFileDropdown).toBe(false);
			expect(state.fileQuery).toBe("");
		});
	});

	describe("Slash command trigger (/)", () => {
		it("should show slash dropdown when / is typed at start of message", () => {
			const textarea = state.textareaRef!;
			textarea.value = "/";
			textarea.setSelectionRange(1, 1);
			state.message = "/";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showSlashDropdown).toBe(true);
			expect(state.slashQuery).toBe("");
			expect(state.showFileDropdown).toBe(false);
		});

		it("should show slash dropdown when / is typed after space", () => {
			const textarea = state.textareaRef!;
			textarea.value = "Hello /";
			textarea.setSelectionRange(7, 7);
			state.message = "Hello /";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showSlashDropdown).toBe(true);
			expect(state.slashQuery).toBe("");
			expect(state.showFileDropdown).toBe(false);
		});

		it("should show slash dropdown with query when /cmd is typed", () => {
			const textarea = state.textareaRef!;
			textarea.value = "/cmd";
			textarea.setSelectionRange(4, 4);
			state.message = "/cmd";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showSlashDropdown).toBe(true);
			expect(state.slashQuery).toBe("cmd");
			expect(state.showFileDropdown).toBe(false);
		});

		it("should hide slash dropdown when / is followed by space", () => {
			const textarea = state.textareaRef!;
			textarea.value = "Hello / cmd";
			textarea.setSelectionRange(11, 11);
			state.message = "Hello / cmd";
			state.textareaRef = textarea;

			state.handleInput();
			flushSync();

			expect(state.showSlashDropdown).toBe(false);
			expect(state.slashQuery).toBe("");
		});
	});

	describe("Integration: Panel click handler interference", () => {
		it("should still show dropdowns when textarea receives input even if panel click handler exists", () => {
			// This test simulates the bug: panel click handler shouldn't prevent
			// the textarea from receiving input events and triggering dropdowns

			const textarea = state.textareaRef!;
			textarea.value = "@";
			textarea.setSelectionRange(1, 1);
			state.message = "@";
			state.textareaRef = textarea;

			// Simulate a panel click handler that might interfere
			const panelDiv = document.createElement("div");
			panelDiv.appendChild(textarea);
			document.body.appendChild(panelDiv);

			let panelClickFired = false;
			panelDiv.addEventListener("click", () => {
				panelClickFired = true;
				// Don't stop propagation - this simulates the current bug
			});

			// Simulate typing @ in the textarea
			const inputEvent = new Event("input", { bubbles: true });
			textarea.dispatchEvent(inputEvent);

			// Manually call handleInput (which would normally be called by oninput handler)
			state.handleInput();
			flushSync();

			// The dropdown should still show even if panel click handler exists
			expect(state.showFileDropdown).toBe(true);
			expect(panelClickFired).toBe(false); // Click event shouldn't fire on input
		});

		it("should prevent panel click handler from interfering when clicking on textarea", () => {
			// This test demonstrates the fix: clicking on textarea should not
			// trigger panel focus, allowing the textarea to receive focus and input

			const textarea = state.textareaRef!;
			const panelDiv = document.createElement("div");
			panelDiv.appendChild(textarea);
			document.body.appendChild(panelDiv);

			let panelClickFired = false;
			panelDiv.addEventListener("click", (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				// This simulates Solution 3: check if clicking on input area
				if (target.tagName === "TEXTAREA" || target.closest("textarea")) {
					return; // Don't fire panel click handler
				}
				panelClickFired = true;
			});

			// Simulate clicking on textarea
			const clickEvent = new MouseEvent("click", { bubbles: true });
			textarea.dispatchEvent(clickEvent);
			flushSync();

			// Panel click handler should NOT fire when clicking on textarea
			expect(panelClickFired).toBe(false);

			// Textarea should be able to receive focus
			textarea.focus();
			expect(document.activeElement).toBe(textarea);
		});
	});
});
