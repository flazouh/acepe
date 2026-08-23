import {
	CommandId,
	emptyComposerMcpCatalog,
	emptySkillsCatalog,
	McpCatalogResolveCommand,
	PreconnectionOptionsLoadCommand,
	SkillsDiscoverCommand
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { fillMcpCommand } from "../mcp/fillCommand.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { fillSkillsDiscoverCommand } from "../skills/discoverCatalog.ts"
import { generateSkillContent } from "../skills/parser.ts"
import { LIBRARY_SEED_PROJECT_ID } from "./seedLibrary.ts"

export const SKILLS_MCP_SEED_HOME = "/tmp/acepe-skills-mcp-244"
export const SKILLS_MCP_SEED_PROJECT_ROOT = "/tmp/acepe"
export const SKILLS_MCP_SEED_SKILL_FOLDER = "issue-244-review"

const prepareSkillHome = Effect.fn("prepareSkillHome")(function*(homeDir: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	if ((yield* fs.exists(homeDir)) === true) {
		yield* fs.remove(homeDir, { recursive: true, force: true })
	}
	const skillDir = path.join(homeDir, ".claude", "skills", SKILLS_MCP_SEED_SKILL_FOLDER)
	yield* fs.makeDirectory(skillDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(skillDir, "SKILL.md"),
		generateSkillContent(
			SKILLS_MCP_SEED_SKILL_FOLDER,
			"Review diffs for issue 244",
			`# ${SKILLS_MCP_SEED_SKILL_FOLDER}`
		)
	)
})

const prepareMcpConfig = Effect.fn("prepareMcpConfig")(function*(projectRoot: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const cursorDir = path.join(projectRoot, ".cursor")
	yield* fs.makeDirectory(cursorDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(cursorDir, "mcp.json"),
		'{"mcpServers":{"github":{"command":"npx"}}}'
	)
})

export const seedSkillsMcp = Effect.fn("seedSkillsMcp")(function*() {
	const engine = yield* OrchestrationEngine
	yield* prepareSkillHome(SKILLS_MCP_SEED_HOME)
	yield* prepareMcpConfig(SKILLS_MCP_SEED_PROJECT_ROOT)
	const filledSkills = yield* fillSkillsDiscoverCommand(
		SkillsDiscoverCommand.make({
			type: "skills.discover",
			commandId: CommandId.make("seed-skills-mcp-discover"),
			catalog: emptySkillsCatalog
		})
	)
	yield* engine.dispatch(filledSkills)
	const filledCatalog = yield* fillMcpCommand(
		McpCatalogResolveCommand.make({
			type: "mcp.catalog.resolve",
			commandId: CommandId.make("seed-skills-mcp-catalog"),
			projectId: LIBRARY_SEED_PROJECT_ID,
			projectRoot: SKILLS_MCP_SEED_PROJECT_ROOT,
			catalog: emptyComposerMcpCatalog
		})
	)
	yield* engine.dispatch(filledCatalog)
	const filledOptions = yield* fillMcpCommand(
		PreconnectionOptionsLoadCommand.make({
			type: "preconnection.options.load",
			commandId: CommandId.make("seed-skills-mcp-options"),
			projectId: LIBRARY_SEED_PROJECT_ID,
			providerId: "claude-code",
			options: []
		})
	)
	yield* engine.dispatch(filledOptions)
})
