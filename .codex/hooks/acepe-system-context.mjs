#!/usr/bin/env node

const chunks = [];

for await (const chunk of process.stdin) {
	chunks.push(chunk);
}

const input = JSON.parse(chunks.join(""));
const eventName = input.hook_event_name;

const context = [
	"# Acepe System Context",
	"",
	"- For Acepe UI or desktop-app inspection, first use the repo QA wrapper in `packages/desktop`: `bun run qa doctor`, `bun run qa observe`, `bun run qa inspect`, `bun run qa click`, `bun run qa reset-onboarding`, and `bun run qa screenshot`.",
	"- Prefer the wrapper over raw Tauri MCP commands. Use raw Tauri MCP only when the wrapper lacks the needed primitive.",
	"- If a new QA/app interaction is not extremely smooth, make the workflow smoother before repeating it: add a wrapper command, helper, hook, skill instruction, or documented primitive so the friction becomes part of the system instead of staying in the conversation.",
	"- For UI-visible work, verification is not complete until the running dev app is inspected through the QA wrapper or Tauri WebView path. Browser-only localhost evidence is not enough for desktop QA.",
	"- If the Acepe dev app or dev server is not available when UI QA is required, start it from `packages/desktop` with `bun run tauri`, then run the QA wrapper pass.",
];

const output = {
	continue: true,
	hookSpecificOutput: {
		hookEventName: eventName,
		additionalContext: context.join("\n"),
	},
	suppressOutput: true,
};

process.stdout.write(`${JSON.stringify(output)}\n`);
