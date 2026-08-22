import type { OrchestrationCommand, SkillsCatalog } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { SkillsService } from "./Services/SkillsService.ts"

export const discoverSkillsCatalog = Effect.fn("discoverSkillsCatalog")(function*() {
	const skills = yield* SkillsService
	const agents = yield* skills.getAgents()
	const agentSkills = yield* skills.listAgentSkills()
	const plugins = yield* skills.getPlugins()
	const pluginSkills = yield* Effect.forEach(plugins, (plugin) =>
		skills.listPluginSkills(plugin.id)
	).pipe(Effect.map((groups) => Arr.flatten(groups)))
	const tree = yield* skills.getSkillsTree()
	return {
		agents,
		agentSkills,
		plugins,
		pluginSkills,
		tree
	} satisfies SkillsCatalog
})

const asDiscoverInvariant = (error: { readonly message: string }) =>
	new OrchestrationCommandInvariantError({
		commandType: "skills.discover",
		detail: error.message
	})

export const fillSkillsDiscoverCommand = Effect.fn("fillSkillsDiscoverCommand")(function*(
	command: OrchestrationCommand
) {
	if (command.type !== "skills.discover") {
		return command
	}
	const catalog = yield* discoverSkillsCatalog().pipe(Effect.mapError(asDiscoverInvariant))
	return {
		type: command.type,
		commandId: command.commandId,
		catalog
	}
})
