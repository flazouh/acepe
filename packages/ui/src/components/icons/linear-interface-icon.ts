import type { ConfirmedLinearInterfaceMapping } from "./confirmed-linear-interface-mapping.js";
import { linearIconData, type LinearIconName } from "./linear-icon-catalog.js";

export type LinearInterfaceIconName =
	| "copy-id"
	| "open-in-new-window"
	| "settings-general";

export type LinearInterfaceIconGlyph = {
	readonly viewBox: string;
	readonly inner: string;
};

export const linearInterfaceIconMappings = {
	"copy-id": {
		linearName: "copy-id",
		surface: "Linear issue copy menu",
		controlLabel: "Copy ID",
		observedBuild: "1.31.1",
		observationMethod: "linear-bundle-control-binding",
		geometryHash: "b854153cf446f3c0af933b1b349771bf9107b80ae3dcbfe8add65e7040530e73",
		sourceChunk: "AgentToolbarActions",
		sourceType: "feature-jsx",
		sourceSet: null,
		originalName: "CopyIdIcon",
		evidenceState: "approved",
		categoryExceptionReason: null,
	},
	"open-in-new-window": {
		linearName: "open-in-new-window",
		surface: "Linear external navigation control",
		controlLabel: "Open in new window",
		observedBuild: "1.31.1",
		observationMethod: "linear-bundle-control-binding",
		geometryHash: "2fc899fe45cce78a3ba453de611bf5f80fde51db37e34c7b0887e63b3854b36c",
		sourceChunk: "AgentToolbarActions",
		sourceType: "feature-jsx",
		sourceSet: null,
		originalName: "OpenInNewWindowIcon",
		evidenceState: "approved",
		categoryExceptionReason: null,
	},
	"settings-general": {
		linearName: "feature-svg6bdd3b6f165e",
		surface: "Linear workspace settings",
		controlLabel: "General",
		observedBuild: "1.31.1",
		observationMethod: "linear-bundle-control-binding",
		geometryHash: "1eee9fc1558004de2bf7731f766f869fc3fcefef1495580b8764afc2ad8b4a6b",
		sourceChunk: "RegisterAction",
		sourceType: "feature-jsx",
		sourceSet: null,
		originalName: "FeatureSvg6bdd3b6f165eIcon",
		evidenceState: "approved",
		categoryExceptionReason: null,
	},
} as const satisfies Record<LinearInterfaceIconName, ConfirmedLinearInterfaceMapping>;

export function getLinearInterfaceIconEvidence(
	name: LinearInterfaceIconName,
): ConfirmedLinearInterfaceMapping {
	return linearInterfaceIconMappings[name];
}

export function resolveLinearInterfaceIconGlyph(
	name: LinearInterfaceIconName,
): LinearInterfaceIconGlyph {
	const evidence = getLinearInterfaceIconEvidence(name);
	const iconName: LinearIconName = evidence.linearName;
	return linearIconData[iconName];
}
