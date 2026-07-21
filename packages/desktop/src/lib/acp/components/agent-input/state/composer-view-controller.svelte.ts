import {
	type AgentInputConfigOption,
	getModeDropdownOptions,
	getSelectedModeOption,
} from "@acepe/ui/agent-panel";
import type { ConfigOptionData } from "../../../../services/converted-session-types.js";
import type { PreconnectionAgentSkillsStore } from "../../../../skills/store/preconnection-agent-skills-store.svelte.js";
import * as agentModelPrefs from "../../../store/agent-model-preferences-store.svelte.js";
import type { AgentStore } from "../../../store/agent-store.svelte.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import type { createLogger } from "../../../utils/logger.js";
import { filterVisibleModes } from "../../../utils/mode-filter.js";
import {
	buildAttachMenuCommandSections,
	buildAttachMenuMcpServerGroups,
	buildAttachMenuModes,
	buildSlashPaletteSections,
	ComposerMcpCatalogState,
	deriveComposerInteractionState,
	getEffectiveFilePickerProjectPath,
	getToolbarConfigOptions,
	hasToolbarCapabilityData,
	type PreconnectionCapabilitiesState,
	type PreconnectionRemoteCommandsState,
	resolveCapabilityContextProviderMetadata,
	resolveCapabilitySource,
	resolveComposerPlaceholder,
	resolvePendingToolbarSelections,
	resolveSelectedModeMenuOptionId,
	resolveSelectorsLoading,
	resolveSlashCommandSource,
	resolveToolbarModeId,
	resolveToolbarModelId,
	sessionCapabilitySourceFromCapabilities,
	shouldShowActiveModeChip,
	shouldShowSlashCommandDropdown,
} from "../composer-controller.js";
import {
	applyProvisionalConfigOptionOverrides,
	listProvisionalConfigEntriesToApply,
} from "../logic/provisional-config-options.js";
import { resolveResolvableToolbarModelId } from "../logic/resolve-resolvable-toolbar-model-id.js";
import type { AgentInputProps } from "../types/agent-input-props.js";
import type { AgentInputState } from "./agent-input-state.svelte.js";

type ComposerLogger = ReturnType<typeof createLogger>;

export type ComposerViewControllerDeps = {
	readonly getProps: () => AgentInputProps;
	readonly getInputState: () => AgentInputState;
	readonly getIsShiftPressed: () => boolean;
	readonly sessionStore: SessionStore;
	readonly panelStore: PanelStore;
	readonly agentStore: AgentStore;
	readonly preconnectionCapabilitiesState: PreconnectionCapabilitiesState;
	readonly preconnectionRemoteCommandsState: PreconnectionRemoteCommandsState;
	readonly preconnectionAgentSkillsStore: PreconnectionAgentSkillsStore;
	readonly logger: ComposerLogger;
};

/**
 * Owns composer toolbar/capability/slash/submit derived state and provisional
 * mode/model selections for one agent-input host. DOM refs and editor sync stay
 * in `agent-input-ui.svelte`; this class holds the reactive view model.
 */
export class ComposerViewController {
	readonly #deps: ComposerViewControllerDeps;

	provisionalModeId = $state<string | null>(null);
	provisionalModelId = $state<string | null>(null);
	provisionalConfigOptions = $state<Record<string, string>>({});
	submittedProvisionalConfigOptions: Record<string, string> = {};
	isApplyingProvisionalToolbarSelections = $state(false);

	#previousComposerBindSessionId = $state<string | null>(null);

	readonly filePickerProjectPath = $derived.by(() => {
		const props = this.#deps.getProps();
		return getEffectiveFilePickerProjectPath(props.projectPath, props.worktreePath);
	});

	readonly panelHotState = $derived.by(() => {
		const panelId = this.#deps.getProps().panelId;
		return panelId ? this.#deps.panelStore.getHotState(panelId) : null;
	});

	readonly sessionIdentity = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionIdentity(sessionId) : null;
	});

	readonly capabilitiesAgentId = $derived.by(() => {
		const props = this.#deps.getProps();
		if (props.sessionId) {
			if (this.sessionIdentity) {
				return this.sessionIdentity.agentId;
			}
			return props.selectedAgentId ? props.selectedAgentId : null;
		}
		if (props.selectedAgentId) {
			return props.selectedAgentId;
		}
		return this.sessionIdentity ? this.sessionIdentity.agentId : null;
	});

	readonly sessionAvailableModels = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionAvailableModels(sessionId) : null;
	});

	readonly sessionAvailableModes = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionAvailableModes(sessionId) : null;
	});

	readonly sessionModelsDisplay = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionModelsDisplay(sessionId) : null;
	});

	readonly sessionProviderMetadata = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionProviderMetadata(sessionId) : null;
	});

	readonly sessionHasCanonicalCapabilities = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId
			? this.#deps.sessionStore.read.hasSessionCanonicalCapabilities(sessionId)
			: false;
	});

	readonly sessionCapabilities = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		if (!sessionId || !this.sessionHasCanonicalCapabilities) {
			return null;
		}
		return {
			availableModels: this.sessionAvailableModels,
			availableModes: this.sessionAvailableModes,
			modelsDisplay: this.sessionModelsDisplay,
			providerMetadata: this.sessionProviderMetadata,
		};
	});

	readonly sessionCapabilitySource = $derived.by(() =>
		sessionCapabilitySourceFromCapabilities(
			this.#deps.getProps().sessionId ?? null,
			this.sessionCapabilities
		)
	);

	readonly capabilitiesAgent = $derived.by(() => {
		const agentId = this.capabilitiesAgentId;
		if (!agentId) {
			return null;
		}
		for (const agent of this.#deps.agentStore.agents) {
			if (agent.id === agentId) {
				return agent;
			}
		}
		return null;
	});

	readonly capabilitiesProviderMetadata = $derived.by(() =>
		resolveCapabilityContextProviderMetadata({
			sessionSource: this.sessionCapabilitySource,
			selectedAgentProviderMetadata: this.capabilitiesAgent
				? (this.capabilitiesAgent.providerMetadata ?? null)
				: null,
		})
	);

	readonly preconnectionCapabilities = $derived.by(() =>
		this.#deps.preconnectionCapabilitiesState.getCapabilities({
			agentId: this.capabilitiesAgentId,
			projectPath: this.filePickerProjectPath,
			preconnectionCapabilityMode:
				this.capabilitiesProviderMetadata?.preconnectionCapabilityMode ?? "unsupported",
		})
	);

	readonly sessionLifecyclePresentation = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId
			? this.#deps.sessionStore.presentation.getSessionLifecyclePresentation(sessionId)
			: null;
	});

	readonly storeComposerState = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.composer.getStoreComposerState(sessionId) : null;
	});

	readonly sessionCurrentModeId = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionCurrentModeId(sessionId) : null;
	});

	readonly sessionCurrentModelId = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionCurrentModelId(sessionId) : null;
	});

	readonly sessionAutonomousEnabled = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId ? this.#deps.sessionStore.read.getSessionAutonomousEnabled(sessionId) : null;
	});

	readonly sessionConfigOptions = $derived.by((): ConfigOptionData[] => {
		const sessionId = this.#deps.getProps().sessionId;
		const baseOptions = sessionId
			? (this.#deps.sessionStore.read.getSessionConfigOptions(sessionId) ?? [])
			: (this.preconnectionCapabilities?.configOptions ?? []);
		return applyProvisionalConfigOptionOverrides(baseOptions, this.provisionalConfigOptions);
	});

	readonly sessionAvailableCommands = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId
			? (this.#deps.sessionStore.read.getSessionAvailableCommands(sessionId) ?? [])
			: [];
	});

	readonly cachedModes = $derived.by(() =>
		this.capabilitiesAgentId ? agentModelPrefs.getCachedModes(this.capabilitiesAgentId) : []
	);

	readonly cachedModels = $derived.by(() =>
		this.capabilitiesAgentId ? agentModelPrefs.getCachedModels(this.capabilitiesAgentId) : []
	);

	readonly cachedModelsDisplay = $derived.by(() =>
		this.capabilitiesAgentId
			? agentModelPrefs.getCachedModelsDisplay(this.capabilitiesAgentId)
			: null
	);

	readonly capabilitySource = $derived.by(() =>
		resolveCapabilitySource({
			sessionSource: this.sessionCapabilitySource,
			preconnectionCapabilities: this.preconnectionCapabilities,
			cachedModes: this.cachedModes,
			cachedModels: this.cachedModels,
			cachedModelsDisplay: this.cachedModelsDisplay,
			providerMetadata: this.capabilitiesProviderMetadata ?? null,
		})
	);

	readonly effectiveCapabilityProviderMetadata = $derived.by(
		() => this.capabilitySource.providerMetadata
	);

	readonly effectiveAvailableModes = $derived.by(() => this.capabilitySource.availableModes ?? []);

	readonly visibleModes = $derived.by(() => filterVisibleModes(this.effectiveAvailableModes));

	readonly effectiveComposerProvisionalModeId = $derived.by(() =>
		this.#deps.getProps().sessionId
			? (this.storeComposerState?.provisionalModeId ?? null)
			: this.provisionalModeId
	);

	readonly effectiveComposerProvisionalModelId = $derived.by(() =>
		this.#deps.getProps().sessionId
			? (this.storeComposerState?.provisionalModelId ?? null)
			: this.provisionalModelId
	);

	readonly effectiveDefaultModelId = $derived.by(() => {
		if (!this.capabilitiesAgentId) {
			return null;
		}

		const preferredProviderId = agentModelPrefs.getModelProvider(this.capabilitiesAgentId);
		const providerScopedDefault = preferredProviderId
			? agentModelPrefs.getDefaultModel(this.capabilitiesAgentId, preferredProviderId)
			: null;
		return providerScopedDefault ?? agentModelPrefs.getDefaultModel(this.capabilitiesAgentId, null);
	});

	readonly effectiveCurrentModeId = $derived.by(() =>
		resolveToolbarModeId({
			liveCurrentModeId: this.sessionCurrentModeId,
			provisionalModeId: this.effectiveComposerProvisionalModeId,
			visibleModes: this.visibleModes,
		})
	);

	readonly effectiveCurrentModeLabel = $derived.by(() => {
		const currentMode = this.visibleModes.find((mode) => mode.id === this.effectiveCurrentModeId);
		return currentMode?.name ?? this.effectiveCurrentModeId;
	});

	readonly panelProvisionalAutonomousEnabled = $derived.by(() => {
		const panelId = this.#deps.getProps().panelId;
		if (panelId) {
			return this.#deps.panelStore.getHotState(panelId).provisionalAutonomousEnabled;
		}
		return false;
	});

	readonly autonomousToggleActive = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		if (sessionId) {
			const cs = this.storeComposerState;
			if (cs && cs.provisionalAutonomousEnabled !== null) {
				return cs.provisionalAutonomousEnabled;
			}
			return this.sessionAutonomousEnabled === true;
		}
		return this.panelProvisionalAutonomousEnabled;
	});

	readonly autonomousToggleBusy = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId
			? this.#deps.sessionStore.read.getSessionAutonomousTransitionBusy(sessionId)
			: false;
	});

	// Auto-approve is an Acepe-side, agent-agnostic permission policy. The toggle
	// is always available; it is only disabled while an enable/disable transition
	// is in flight.
	readonly autonomousDisabled = $derived.by(() => this.autonomousToggleBusy);

	readonly selectedModeMenuOptionId = $derived.by(() =>
		resolveSelectedModeMenuOptionId({
			currentModeId: this.effectiveCurrentModeId,
			autonomousEnabled: this.autonomousToggleActive,
		})
	);

	readonly effectiveAvailableModels = $derived.by(
		() => this.capabilitySource.availableModels ?? []
	);

	readonly effectiveModelsDisplay = $derived.by(() => this.capabilitySource.modelsDisplay);

	readonly effectiveCurrentModelId = $derived.by(() =>
		resolveToolbarModelId({
			liveCurrentModelId: this.sessionCurrentModelId,
			provisionalModelId: this.effectiveComposerProvisionalModelId,
			defaultModelId: this.effectiveDefaultModelId,
			availableModels: this.effectiveAvailableModels,
			allowsImplicitModelSelection:
				this.effectiveCapabilityProviderMetadata?.allowsImplicitModelSelection ?? true,
		})
	);

	readonly resolvableToolbarModelId = $derived.by(() =>
		resolveResolvableToolbarModelId({
			provisionalModelId: this.effectiveComposerProvisionalModelId,
			resolvedToolbarModelId: this.effectiveCurrentModelId,
		})
	);

	readonly toolbarConfigOptions = $derived.by((): AgentInputConfigOption[] => {
		if (this.sessionConfigOptions.length === 0) {
			return [];
		}
		return getToolbarConfigOptions(
			this.sessionConfigOptions,
			this.effectiveAvailableModels,
			this.effectiveModelsDisplay
		).map((option): AgentInputConfigOption => {
			const raw = option.currentValue;
			const currentValue: string | number | boolean | null =
				raw === null || raw === undefined
					? null
					: typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
						? raw
						: null;
			const options = option.options?.flatMap(
				(opt): { value: string | number | boolean; name: string }[] => {
					const v = opt.value;
					if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
						return [{ value: v, name: opt.name }];
					}
					return [];
				}
			);
			return {
				id: option.id,
				name: option.name,
				category: option.category,
				type: option.type,
				description: option.description ?? null,
				currentValue,
				options,
				presentation: option.presentation ?? "advanced",
			};
		});
	});

	readonly liveAvailableCommands = $derived.by(() => {
		if (this.sessionAvailableCommands.length > 0) {
			return this.sessionAvailableCommands;
		}
		return [];
	});

	readonly preconnectionAvailableCommands = $derived.by(() => {
		if (!this.capabilitiesAgentId) {
			return [];
		}
		return this.#deps.preconnectionRemoteCommandsState.getCommands({
			agentId: this.capabilitiesAgentId,
			projectPath: this.filePickerProjectPath,
			preconnectionSlashMode:
				this.effectiveCapabilityProviderMetadata?.preconnectionSlashMode ?? "unsupported",
			skillCommands: this.#deps.preconnectionAgentSkillsStore.getCommandsForAgent(
				this.capabilitiesAgentId
			),
		});
	});

	readonly hasSession = $derived.by(() => {
		const sessionId = this.#deps.getProps().sessionId;
		return sessionId !== null && sessionId !== undefined;
	});

	readonly slashCommandSource = $derived.by(() =>
		resolveSlashCommandSource({
			liveCommands: this.liveAvailableCommands,
			hasSession: this.hasSession,
			hasConnectedSession: this.sessionLifecyclePresentation?.connectionPhase === "connected",
			selectedAgentId: this.capabilitiesAgentId,
			preconnectionCommands: this.preconnectionAvailableCommands,
		})
	);

	readonly effectiveAvailableCommands = $derived.by(() => this.slashCommandSource.commands);

	readonly mcpCatalogState = new ComposerMcpCatalogState();

	readonly attachMenuModes = $derived.by(() =>
		buildAttachMenuModes({
			modes: this.visibleModes,
			currentModeId: this.effectiveCurrentModeId,
		})
	);

	readonly attachMenuCommandSections = $derived.by(() =>
		buildAttachMenuCommandSections({
			commands: this.effectiveAvailableCommands,
			preconnectionCommands: this.preconnectionAvailableCommands,
		})
	);

	readonly attachMenuMcpServerGroups = $derived.by(() =>
		buildAttachMenuMcpServerGroups(
			this.mcpCatalogState.getCatalog({
				agentId: this.capabilitiesAgentId,
				projectPath: this.filePickerProjectPath,
				sessionId: this.#deps.getProps().sessionId ?? null,
			})
		)
	);

	readonly attachMenuMcpCatalogLoading = $derived.by(() =>
		this.mcpCatalogState.isLoading({
			agentId: this.capabilitiesAgentId,
			projectPath: this.filePickerProjectPath,
			sessionId: this.#deps.getProps().sessionId ?? null,
		})
	);

	readonly attachMenuMcpCatalogInput = $derived.by(() => ({
		agentId: this.capabilitiesAgentId,
		projectPath: this.filePickerProjectPath,
		sessionId: this.#deps.getProps().sessionId ?? null,
	}));

	readonly attachMenuShowMcpSection = $derived.by(
		() =>
			this.attachMenuMcpCatalogInput.agentId !== null &&
			this.attachMenuMcpCatalogInput.projectPath !== null
	);

	readonly attachMenuMcpCatalogLoaded = $derived.by(() =>
		this.mcpCatalogState.hasLoaded(this.attachMenuMcpCatalogInput)
	);

	readonly slashPaletteSections = $derived.by(() =>
		buildSlashPaletteSections({
			modes: this.visibleModes,
			currentModeId: this.effectiveCurrentModeId,
			availableModels: this.effectiveAvailableModels,
			modelsDisplay: this.effectiveModelsDisplay,
			currentModelId: this.effectiveCurrentModelId,
			agentId: this.capabilitiesAgentId,
			providerMetadata: this.effectiveCapabilityProviderMetadata,
			commands: this.effectiveAvailableCommands,
			preconnectionCommands: this.preconnectionAvailableCommands,
			mcpCatalog: this.mcpCatalogState.getCatalog(this.attachMenuMcpCatalogInput),
		})
	);

	readonly slashPaletteHasContent = $derived.by(() => {
		for (const section of this.slashPaletteSections) {
			if (section.items.length > 0) {
				return true;
			}
		}
		return false;
	});

	refreshAttachMenuMcpCatalog(force = false): void {
		if (!this.attachMenuShowMcpSection) {
			return;
		}
		void this.mcpCatalogState.ensureLoaded(this.attachMenuMcpCatalogInput, { force });
	}

	readonly selectedModeOption = $derived.by(() =>
		getSelectedModeOption({
			modeOptions: getModeDropdownOptions(this.visibleModes),
			currentModeId: this.effectiveCurrentModeId,
		})
	);

	readonly composerPlaceholderLabel = $derived.by(() =>
		resolveComposerPlaceholder({
			hasSession: this.hasSession,
		})
	);

	readonly showActiveModeChip = $derived.by(() =>
		shouldShowActiveModeChip(this.visibleModes, this.effectiveCurrentModeId)
	);

	readonly isSlashDropdownVisible = $derived.by(() =>
		shouldShowSlashCommandDropdown({
			isTriggerActive: this.#deps.getInputState().showSlashDropdown,
			source: this.slashCommandSource,
			capabilitiesAgentId: this.capabilitiesAgentId,
			hasPaletteContent: this.slashPaletteHasContent,
		})
	);

	readonly inputReady = $derived.by(() => {
		const props = this.#deps.getProps();
		return Boolean(props.sessionId) || Boolean(this.filePickerProjectPath);
	});

	readonly isStreaming = $derived.by(() => {
		const props = this.#deps.getProps();
		return (
			props.sessionShowStop ??
			this.sessionLifecyclePresentation?.showStop ??
			props.sessionIsStreaming ??
			false
		);
	});

	readonly isAgentBusy = $derived.by(() => {
		const props = this.#deps.getProps();
		return props.sessionShowStop ?? this.sessionLifecyclePresentation?.canCancel ?? false;
	});

	readonly isSubmitDisabled = $derived.by(() => {
		const props = this.#deps.getProps();
		if (props.disableSend) {
			return true;
		}
		if (props.sessionId) {
			return (props.sessionCanSubmit ?? this.sessionLifecyclePresentation?.canSubmit) !== true;
		}
		return false;
	});

	readonly isSessionConnecting = $derived.by(
		() => this.sessionLifecyclePresentation?.connectionPhase === "connecting"
	);

	readonly hasCachedToolbarData = $derived.by(() =>
		hasToolbarCapabilityData({
			visibleModesCount: this.visibleModes.length,
			availableModelsCount: this.effectiveAvailableModels.length,
			modelsDisplay: this.effectiveModelsDisplay,
		})
	);

	readonly selectorsLoading = $derived.by(() =>
		resolveSelectorsLoading({
			hasSession: this.hasSession,
			isSessionConnecting: this.isSessionConnecting,
			hasSelectedAgent: Boolean(this.capabilitiesAgentId),
			visibleModesCount: this.visibleModes.length,
			availableModelsCount: this.effectiveAvailableModels.length,
			modelsDisplay: this.effectiveModelsDisplay,
			isCacheLoaded: agentModelPrefs.isCacheLoaded(),
			isPreconnectionLoading: this.#deps.preconnectionCapabilitiesState.isLoading({
				agentId: this.capabilitiesAgentId,
				projectPath: this.filePickerProjectPath,
				preconnectionCapabilityMode:
					this.effectiveCapabilityProviderMetadata?.preconnectionCapabilityMode ?? "unsupported",
			}),
			resolvableModelId: this.resolvableToolbarModelId,
		})
	);

	readonly hasDraftInput = $derived.by(() => {
		const inputState = this.#deps.getInputState();
		return inputState.message.trim().length > 0 || inputState.attachments.length > 0;
	});

	readonly selectorsDisabledByComposer = $derived.by(
		() => this.storeComposerState?.selectorsDisabled ?? false
	);

	readonly composerInteraction = $derived.by(() => {
		const hasBlocking = this.storeComposerState?.isBlocked ?? false;
		const isDispatching = this.storeComposerState?.isDispatching ?? false;
		return deriveComposerInteractionState({
			hasDraftInput: this.hasDraftInput,
			hasSessionId: Boolean(this.#deps.getProps().sessionId),
			isAgentBusy: this.isAgentBusy,
			isStreaming: this.isStreaming,
			isShiftPressed: this.#deps.getIsShiftPressed(),
			isSubmitDisabled: this.isSubmitDisabled,
			hasBlockingComposerConfig: hasBlocking,
			isComposerDispatching: isDispatching,
		});
	});

	constructor(deps: ComposerViewControllerDeps) {
		this.#deps = deps;
		this.provisionalModeId = deps.getProps().initialModeId ?? null;
	}

	syncComposerSessionBind(): void {
		const sessionId = this.#deps.getProps().sessionId;
		if (!sessionId) {
			this.#previousComposerBindSessionId = null;
			return;
		}
		if (sessionId === this.#previousComposerBindSessionId) {
			return;
		}
		this.#previousComposerBindSessionId = sessionId;
		this.#deps.sessionStore.composer.bindSession(sessionId);
	}

	syncPreconnectionCapabilities(): void {
		const hasConnectedSession = this.sessionLifecyclePresentation?.connectionPhase === "connected";
		this.#deps.preconnectionCapabilitiesState
			.ensureLoaded({
				agentId: this.capabilitiesAgentId,
				hasConnectedSession,
				projectPath: this.filePickerProjectPath,
				preconnectionCapabilityMode:
					this.effectiveCapabilityProviderMetadata?.preconnectionCapabilityMode ?? "unsupported",
			})
			.mapErr((error) => {
				this.#deps.logger.error("Failed to warm preconnection capabilities", {
					agentId: this.capabilitiesAgentId,
					projectPath: this.filePickerProjectPath,
					error: error.message,
				});
				return undefined;
			});
	}

	setProvisionalConfigOption(configId: string, value: string): void {
		const next: Record<string, string> = {};
		for (const [key, existingValue] of Object.entries(this.provisionalConfigOptions)) {
			next[key] = existingValue;
		}
		next[configId] = value;
		this.provisionalConfigOptions = next;

		const nextSubmitted: Record<string, string> = {};
		for (const [key, existingValue] of Object.entries(this.submittedProvisionalConfigOptions)) {
			if (key !== configId) {
				nextSubmitted[key] = existingValue;
			}
		}
		this.submittedProvisionalConfigOptions = nextSubmitted;
	}

	markProvisionalConfigOptionSubmitted(configId: string, value: string): void {
		const next: Record<string, string> = {};
		for (const [key, existingValue] of Object.entries(this.submittedProvisionalConfigOptions)) {
			next[key] = existingValue;
		}
		next[configId] = value;
		this.submittedProvisionalConfigOptions = next;
	}

	clearProvisionalConfigOption(configId: string): void {
		const next: Record<string, string> = {};
		for (const [key, existingValue] of Object.entries(this.provisionalConfigOptions)) {
			if (key !== configId) {
				next[key] = existingValue;
			}
		}
		this.provisionalConfigOptions = next;

		const nextSubmitted: Record<string, string> = {};
		for (const [key, existingValue] of Object.entries(this.submittedProvisionalConfigOptions)) {
			if (key !== configId) {
				nextSubmitted[key] = existingValue;
			}
		}
		this.submittedProvisionalConfigOptions = nextSubmitted;
	}

	clearProvisionalConfigOptions(): void {
		this.provisionalConfigOptions = {};
		this.submittedProvisionalConfigOptions = {};
	}

	syncPendingToolbarSelections(): void {
		const sessionId = this.#deps.getProps().sessionId;
		if (!sessionId || this.isApplyingProvisionalToolbarSelections) {
			return;
		}
		if (this.sessionLifecyclePresentation?.connectionPhase !== "connected") {
			return;
		}

		const cs = this.#deps.sessionStore.composer.getStoreComposerState(sessionId);
		const provMode = cs?.provisionalModeId ?? null;
		const provModel = cs?.provisionalModelId ?? null;

		const resolution = resolvePendingToolbarSelections({
			provisionalModeId: provMode,
			provisionalModelId: provModel,
			liveCurrentModeId: this.sessionCurrentModeId,
			liveCurrentModelId: this.sessionCurrentModelId,
			availableModes: this.visibleModes,
			availableModels: this.effectiveAvailableModels,
		});

		const liveModeId = this.sessionCurrentModeId;
		const liveModelId = this.sessionCurrentModelId;
		const liveConfigOptions = this.#deps.sessionStore.read.getSessionConfigOptions(sessionId);
		const configEntriesToApply = listProvisionalConfigEntriesToApply({
			provisionalValues: this.provisionalConfigOptions,
			liveConfigOptions,
		}).filter((entry) => this.submittedProvisionalConfigOptions[entry.configId] !== entry.value);

		if (
			!resolution.modeIdToApply &&
			!resolution.modelIdToApply &&
			configEntriesToApply.length === 0
		) {
			return;
		}

		this.isApplyingProvisionalToolbarSelections = true;

		const run = async () => {
			const autonomousForBegin = cs?.provisionalAutonomousEnabled ?? this.sessionAutonomousEnabled;
			await this.#deps.sessionStore.composer.runConfigOperation(
				sessionId,
				{
					provisionalModeId: resolution.modeIdToApply ?? provMode ?? liveModeId,
					provisionalModelId: resolution.modelIdToApply ?? provModel ?? liveModelId,
					provisionalAutonomousEnabled: autonomousForBegin,
				},
				async () => {
					if (resolution.modeIdToApply) {
						const modeResult = await this.#deps.sessionStore.connection.setMode(
							sessionId,
							resolution.modeIdToApply
						);
						if (modeResult.isErr()) {
							return false;
						}
					}

					if (resolution.modelIdToApply) {
						const modelResult = await this.#deps.sessionStore.connection.setModel(
							sessionId,
							resolution.modelIdToApply
						);
						if (modelResult.isErr()) {
							return false;
						}
					}

					for (const entry of configEntriesToApply) {
						const configResult = await this.#deps.sessionStore.connection.setConfigOption(
							sessionId,
							entry.configId,
							entry.value
						);
						if (configResult.isErr()) {
							return false;
						}
					}

					return true;
				}
			);
		};

		void run().finally(() => {
			this.isApplyingProvisionalToolbarSelections = false;
			if (configEntriesToApply.length > 0) {
				this.clearProvisionalConfigOptions();
			}
		});
	}
}
