import { AgentJson } from "./agentJson.ts"

export const defaultLocalOverrides: ReadonlyArray<AgentJson> = [
	AgentJson.make({
		id: "claude-code",
		name: "Claude Code",
		version: "0.0.0",
		distribution: {
			npx: {
				package: "@anthropic-ai/claude-code"
			}
		}
	}),
	AgentJson.make({
		id: "copilot",
		name: "GitHub Copilot",
		version: "0.0.0",
		distribution: {
			npx: {
				package: "@github/copilot"
			}
		}
	}),
	AgentJson.make({
		id: "codex",
		name: "Codex",
		version: "0.0.0",
		distribution: {
			npx: {
				package: "@openai/codex"
			}
		}
	})
]
