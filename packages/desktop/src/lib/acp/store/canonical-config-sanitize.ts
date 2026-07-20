/**
 * Canonical config + capability sanitization for the session store: redact
 * credential-like config values, sanitize config options, and sanitize a graph
 * capabilities snapshot. Pure transforms with credential-redaction safety logic
 * isolated for testability. GOD-safe.
 */
import type {
	ConfigOptionData as CanonicalConfigOptionData,
	ConfigOptionValue as CanonicalConfigOptionValue,
	JsonValue,
	SessionGraphCapabilities,
} from "../../services/acp-types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: "canonical-config-sanitize",
	name: "CanonicalConfigSanitize",
});
const MAX_CANONICAL_CONFIG_STRING_LENGTH = 512;

function isJsonObjectValue(value: JsonValue): boolean {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedConfigIdentityText(option: CanonicalConfigOptionData): string {
	return `${option.id} ${option.name} ${option.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function configIdentityContainsCredentialLabel(option: CanonicalConfigOptionData): boolean {
	const identityText = `${option.id} ${option.name} ${option.category}`.toLowerCase();
	const normalizedIdentityText = normalizedConfigIdentityText(option);
	return [
		"api_key",
		"apikey",
		"access_key",
		"accesskey",
		"access_token",
		"refresh_token",
		"auth_token",
		"bearer",
		"credential",
		"oauth",
		"password",
		"private_key",
		"privatekey",
		"secret",
	].some((needle) => identityText.includes(needle) || normalizedIdentityText.includes(needle));
}

function looksLikeCredentialValue(value: string): boolean {
	const lowerValue = value.toLowerCase();
	return (
		lowerValue.startsWith("bearer ") ||
		lowerValue.startsWith("basic ") ||
		lowerValue.startsWith("sk-") ||
		lowerValue.startsWith("ghp_") ||
		lowerValue.startsWith("gho_") ||
		lowerValue.startsWith("github_pat_") ||
		lowerValue.startsWith("xoxb-") ||
		(value.startsWith("eyJ") && value.split(".").length === 3)
	);
}

function sanitizeCanonicalConfigValue(
	value: JsonValue,
	option: CanonicalConfigOptionData,
	field: "currentValue" | "option.value"
): JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number") {
		return value;
	}

	if (typeof value === "string") {
		const trimmedValue = value.trim();
		const shouldRedact =
			trimmedValue.length > MAX_CANONICAL_CONFIG_STRING_LENGTH ||
			trimmedValue.includes("\n") ||
			trimmedValue.includes("\r") ||
			configIdentityContainsCredentialLabel(option) ||
			looksLikeCredentialValue(trimmedValue);
		if (shouldRedact) {
			logger.warn("Redacting unsafe canonical config option value", {
				configId: option.id,
				configName: option.name,
				configCategory: option.category,
				field,
			});
			return null;
		}
		return value;
	}

	if (Array.isArray(value) || isJsonObjectValue(value)) {
		logger.warn("Redacting structured canonical config option value", {
			configId: option.id,
			configName: option.name,
			configCategory: option.category,
			field,
		});
		return null;
	}

	return null;
}

function sanitizeCanonicalConfigOptions(
	options: ReadonlyArray<CanonicalConfigOptionData>
): Array<CanonicalConfigOptionData> {
	return options.map((option) => {
		const sanitizedOptions = (option.options ?? []).map(
			(candidate: CanonicalConfigOptionValue) => ({
				name: candidate.name,
				value: sanitizeCanonicalConfigValue(candidate.value, option, "option.value"),
			})
		);
		const optionsWithDescriptions = sanitizedOptions.map((candidate, index) => {
			const originalDescription = option.options?.[index]?.description;
			if (originalDescription === undefined) {
				return candidate;
			}
			return {
				name: candidate.name,
				value: candidate.value,
				description: originalDescription,
			};
		});
		const sanitizedOptionBase = {
			id: option.id,
			name: option.name,
			category: option.category,
			type: option.type,
			presentation: option.presentation ?? "advanced",
			options: optionsWithDescriptions,
		};
		const sanitizedOptionWithDescription =
			option.description === undefined
				? sanitizedOptionBase
				: {
						id: sanitizedOptionBase.id,
						name: sanitizedOptionBase.name,
						category: sanitizedOptionBase.category,
						type: sanitizedOptionBase.type,
						presentation: sanitizedOptionBase.presentation,
						description: option.description,
						options: sanitizedOptionBase.options,
					};
		if (option.currentValue === undefined) {
			return sanitizedOptionWithDescription;
		}
		const sanitizedCurrentValue = sanitizeCanonicalConfigValue(
			option.currentValue,
			option,
			"currentValue"
		);
		if (option.description === undefined) {
			return {
				id: sanitizedOptionBase.id,
				name: sanitizedOptionBase.name,
				category: sanitizedOptionBase.category,
				type: sanitizedOptionBase.type,
				presentation: sanitizedOptionBase.presentation,
				currentValue: sanitizedCurrentValue,
				options: sanitizedOptionBase.options,
			};
		}
		return {
			id: sanitizedOptionWithDescription.id,
			name: sanitizedOptionWithDescription.name,
			category: sanitizedOptionWithDescription.category,
			type: sanitizedOptionWithDescription.type,
			presentation: sanitizedOptionWithDescription.presentation,
			description: option.description,
			currentValue: sanitizedCurrentValue,
			options: sanitizedOptionWithDescription.options,
		};
	});
}

export function sanitizeCanonicalCapabilities(
	capabilities: SessionGraphCapabilities
): SessionGraphCapabilities {
	return {
		models: capabilities.models ?? null,
		modes: capabilities.modes ?? null,
		availableCommands: capabilities.availableCommands,
		configOptions:
			capabilities.configOptions === undefined || capabilities.configOptions === null
				? capabilities.configOptions
				: sanitizeCanonicalConfigOptions(capabilities.configOptions),
		autonomousEnabled: capabilities.autonomousEnabled,
	};
}
