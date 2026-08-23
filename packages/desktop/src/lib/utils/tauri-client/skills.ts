import {
	emptySkillsCatalog,
	type PluginInfo as ContractPluginInfo,
	type PluginSkill as ContractPluginSkill,
	type Skill as ContractSkill,
	type SkillTreeNode as ContractSkillTreeNode,
	skillsSnapshotRequest,
	type SkillsCatalog,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import { AgentError, type AppError } from "../../acp/errors/app-error.js";
import type {
	AgentSkills,
	LibrarySkill,
	LibrarySkillWithSync,
	PluginInfo,
	PluginSkill,
	Skill,
	SkillSyncResult,
	SkillTreeNode,
	SyncResult,
	SyncTarget,
} from "../../skills/types/index.js";
import {
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";

const TREE_NODE_TYPES = [
	"agent",
	"skill",
	"plugins-section",
	"plugin",
	"plugin-skill",
] as const;

type TreeNodeType = (typeof TREE_NODE_TYPES)[number];

const toTreeNodeType = (value: string): TreeNodeType => {
	for (const nodeType of TREE_NODE_TYPES) {
		if (nodeType === value) {
			return nodeType;
		}
	}
	return "skill";
};

const mapSkill = (skill: ContractSkill): Skill => ({
	id: skill.id,
	agentId: skill.agentId,
	folderName: skill.folderName,
	path: skill.path,
	name: skill.name,
	description: skill.description,
	content: skill.content,
	modifiedAt: skill.modifiedAt,
});

const mapPluginSkill = (skill: ContractPluginSkill): PluginSkill => ({
	id: skill.id,
	pluginId: skill.pluginId,
	folderName: skill.folderName,
	path: skill.path,
	name: skill.name,
	description: skill.description,
	content: skill.content,
	modifiedAt: skill.modifiedAt,
});

const mapPluginInfo = (plugin: ContractPluginInfo): PluginInfo => ({
	id: plugin.id,
	marketplace: plugin.marketplace,
	name: plugin.name,
	version: plugin.version,
	skillsDir: plugin.skillsDir,
	skillCount: plugin.skillCount,
});

const mapTreeNode = (node: ContractSkillTreeNode): SkillTreeNode => {
	const children: SkillTreeNode[] = [];
	for (const child of node.children) {
		children.push(mapTreeNode(child));
	}
	return {
		id: node.id,
		label: node.label,
		nodeType: toTreeNodeType(node.nodeType),
		agentId: node.agentId,
		children,
		isExpandable: node.isExpandable,
	};
};

const loadSkillsCatalog = Effect.fn("loadSkillsCatalog")(function* () {
	const commandId = yield* nextCommandId("skills-discover");
	yield* withRpcClient("skills.discover", (client) =>
		client.dispatch({
			type: "skills.discover",
			commandId,
			catalog: emptySkillsCatalog,
		})
	);
	const snapshot = yield* withRpcClient("skills.snapshot", (client) =>
		client.snapshot(skillsSnapshotRequest())
	);
	if (snapshot.skillsCatalog === null) {
		return emptySkillsCatalog;
	}
	return snapshot.skillsCatalog;
});

const findSkill = (catalog: SkillsCatalog, skillId: string): Skill | null => {
	for (const group of catalog.agentSkills) {
		for (const skill of group.skills) {
			if (skill.id === skillId) {
				return mapSkill(skill);
			}
		}
	}
	return null;
};

const findPluginSkill = (catalog: SkillsCatalog, skillId: string): PluginSkill | null => {
	for (const skill of catalog.pluginSkills) {
		if (skill.id === skillId) {
			return mapPluginSkill(skill);
		}
	}
	return null;
};

export const skills = {
	listTree: (): Effect.Effect<SkillTreeNode[], AppError> =>
		loadSkillsCatalog().pipe(
			Effect.map((catalog) => {
				const tree: SkillTreeNode[] = [];
				for (const node of catalog.tree) {
					tree.push(mapTreeNode(node));
				}
				return tree;
			})
		),

	listAgentSkills: (): Effect.Effect<AgentSkills[], AppError> =>
		loadSkillsCatalog().pipe(
			Effect.map((catalog) => {
				const groups: AgentSkills[] = [];
				for (const group of catalog.agentSkills) {
					const mappedSkills: Skill[] = [];
					for (const skill of group.skills) {
						mappedSkills.push(mapSkill(skill));
					}
					groups.push({
						agentId: group.agentId,
						skills: mappedSkills,
					});
				}
				return groups;
			})
		),

	get: (skillId: string): Effect.Effect<Skill, AppError> =>
		loadSkillsCatalog().pipe(
			Effect.flatMap((catalog) => {
				const found = findSkill(catalog, skillId);
				if (found === null) {
					return Effect.fail(
						new AgentError("skills.get", new Error(`skill not found: ${skillId}`))
					);
				}
				return Effect.succeed(found);
			})
		),

	create: (
		_agentId: string,
		_folderName: string,
		_name: string,
		_description: string
	): Effect.Effect<Skill, AppError> => unsupportedOnContract("skills.create"),

	update: (_skillId: string, _content: string): Effect.Effect<Skill, AppError> =>
		unsupportedOnContract("skills.update"),

	delete: (_skillId: string): Effect.Effect<void, AppError> =>
		unsupportedOnContract("skills.delete"),

	copyTo: (
		_skillId: string,
		_targetAgentId: string,
		_newFolderName?: string
	): Effect.Effect<Skill, AppError> => unsupportedOnContract("skills.copyTo"),

	startWatching: (): Effect.Effect<void, AppError> => Effect.void,

	stopWatching: (): Effect.Effect<void, AppError> => Effect.void,

	listPlugins: (): Effect.Effect<PluginInfo[], AppError> =>
		loadSkillsCatalog().pipe(
			Effect.map((catalog) => {
				const plugins: PluginInfo[] = [];
				for (const plugin of catalog.plugins) {
					plugins.push(mapPluginInfo(plugin));
				}
				return plugins;
			})
		),

	listPluginSkills: (pluginId: string): Effect.Effect<PluginSkill[], AppError> =>
		loadSkillsCatalog().pipe(
			Effect.map((catalog) => {
				const skillsForPlugin: PluginSkill[] = [];
				for (const skill of catalog.pluginSkills) {
					if (skill.pluginId === pluginId) {
						skillsForPlugin.push(mapPluginSkill(skill));
					}
				}
				return skillsForPlugin;
			})
		),

	getPluginSkill: (skillId: string): Effect.Effect<PluginSkill, AppError> =>
		loadSkillsCatalog().pipe(
			Effect.flatMap((catalog) => {
				const found = findPluginSkill(catalog, skillId);
				if (found === null) {
					return Effect.fail(
						new AgentError(
							"skills.getPluginSkill",
							new Error(`plugin skill not found: ${skillId}`)
						)
					);
				}
				return Effect.succeed(found);
			})
		),

	copyPluginSkillToAgent: (
		_skillId: string,
		_targetAgentId: string
	): Effect.Effect<Skill, AppError> =>
		unsupportedOnContract("skills.copyPluginSkillToAgent"),

	libraryListSkills: (): Effect.Effect<LibrarySkill[], AppError> => Effect.succeed([]),

	libraryListSkillsWithSync: (): Effect.Effect<LibrarySkillWithSync[], AppError> =>
		Effect.succeed([]),

	libraryGetSkill: (_skillId: string): Effect.Effect<LibrarySkillWithSync, AppError> =>
		unsupportedOnContract("skills.libraryGetSkill"),

	libraryCreateSkill: (
		_name: string,
		_description: string | null,
		_content: string,
		_category: string | null
	): Effect.Effect<LibrarySkill, AppError> =>
		unsupportedOnContract("skills.libraryCreateSkill"),

	libraryUpdateSkill: (
		_skillId: string,
		_name?: string,
		_description?: string | null,
		_content?: string,
		_category?: string | null
	): Effect.Effect<LibrarySkill, AppError> =>
		unsupportedOnContract("skills.libraryUpdateSkill"),

	libraryDeleteSkill: (_skillId: string): Effect.Effect<void, AppError> =>
		unsupportedOnContract("skills.libraryDeleteSkill"),

	libraryGetSyncTargets: (_skillId: string): Effect.Effect<SyncTarget[], AppError> =>
		unsupportedOnContract("skills.libraryGetSyncTargets"),

	librarySetSyncTarget: (
		_skillId: string,
		_agentId: string,
		_enabled: boolean
	): Effect.Effect<void, AppError> =>
		unsupportedOnContract("skills.librarySetSyncTarget"),

	librarySyncSkill: (_skillId: string): Effect.Effect<SkillSyncResult[], AppError> =>
		unsupportedOnContract("skills.librarySyncSkill"),

	librarySyncAll: (): Effect.Effect<SyncResult, AppError> =>
		unsupportedOnContract("skills.librarySyncAll"),

	libraryIsEmpty: (): Effect.Effect<boolean, AppError> => Effect.succeed(true),

	libraryImportExisting: (): Effect.Effect<LibrarySkill[], AppError> =>
		unsupportedOnContract("skills.libraryImportExisting"),

	libraryGetSkillFolderPath: (
		_agentId: string,
		_skillName: string
	): Effect.Effect<string | null, AppError> => Effect.succeed(null),

	libraryDeleteSkillFromAgents: (
		_skillName: string,
		_agentIds: string[]
	): Effect.Effect<SkillSyncResult[], AppError> =>
		unsupportedOnContract("skills.libraryDeleteSkillFromAgents"),
};
