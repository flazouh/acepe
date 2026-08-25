import type { HugeiconsIconName } from "../icons/index.js";

export type AppTabStatus =
	| "idle"
	| "running"
	| "done"
	| "error"
	| "unseen"
	| "question";
export type AppTabMode = string | null;

/** Updater stage that drives the sidebar update card's appearance. */
export type SidebarUpdateKind =
	| "available"
	| "downloading"
	| "installing"
	| "error";

export interface AppTab {
	id: string;
	title: string;
	projectName?: string;
	projectBadgeLabel?: string | null;
	projectColor?: string;
	projectIconSrc?: string | null;
	/** Per-project session sequence number, rendered inside the project badge. */
	sequenceId?: number | null;
	agentIconSrc?: string;
	mode?: AppTabMode;
	status?: AppTabStatus;
	isFocused?: boolean;
	/** Text shown in the tooltip on hover */
	tooltipText?: string;
}

/** One icon-only control in the window top bar. */
export interface AppTopBarAction {
	id: string;
	icon: HugeiconsIconName;
	/** Tooltip and accessible name. */
	label: string;
	onSelect: () => void;
}

export interface AppSessionItem {
	id: string;
	title: string;
	agentIconSrc?: string;
	status?: AppTabStatus;
	isActive?: boolean;
}

export interface AppProjectGroup {
	name: string;
	badgeLabel?: string | null;
	color?: string;
	iconSrc?: string | null;
	sessions: AppSessionItem[];
}

export interface AppTabGroup {
	projectName: string;
	projectBadgeLabel?: string | null;
	projectColor: string;
	projectIconSrc?: string | null;
	tabs: AppTab[];
}
