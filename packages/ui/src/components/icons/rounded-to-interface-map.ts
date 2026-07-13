import type { ConfirmedInterfaceIconMapping } from "./confirmed-interface-icon-mapping.js";
import type { LinearIconName } from "./linear-icon-catalog.js";
import type { RoundedIconName } from "./rounded-icon-data.generated.js";

export const confirmedInterfaceIconMappings = {} as const satisfies Record<
	string,
	ConfirmedInterfaceIconMapping
>;

export type ConfirmedInterfaceRoundedIconName =
	keyof typeof confirmedInterfaceIconMappings;

export function isConfirmedInterfaceRoundedIcon(
	_name: RoundedIconName,
): _name is ConfirmedInterfaceRoundedIconName {
	return false;
}

export function getConfirmedInterfaceRoundedIconEvidence(
	_name: RoundedIconName,
): ConfirmedInterfaceIconMapping | null {
	return null;
}

export function mapRoundedIconToInterface(_name: RoundedIconName): LinearIconName | null {
	return null;
}
