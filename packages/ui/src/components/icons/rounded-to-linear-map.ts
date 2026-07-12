import type { ConfirmedLinearInterfaceMapping } from "./confirmed-linear-interface-mapping.js";
import type { LinearIconName } from "./linear-icon-catalog.js";
import type { RoundedIconName } from "./rounded-icon-data.generated.js";

export const confirmedLinearInterfaceMappings = {} as const satisfies Record<
	string,
	ConfirmedLinearInterfaceMapping
>;

export type ConfirmedLinearRoundedIconName =
	keyof typeof confirmedLinearInterfaceMappings;

export function isConfirmedLinearRoundedIcon(
	_name: RoundedIconName,
): _name is ConfirmedLinearRoundedIconName {
	return false;
}

export function getConfirmedLinearRoundedIconEvidence(
	_name: RoundedIconName,
): ConfirmedLinearInterfaceMapping | null {
	return null;
}

export function mapRoundedIconToLinear(_name: RoundedIconName): LinearIconName | null {
	return null;
}
