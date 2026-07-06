export { default as AppMainLayout } from "./app-main-layout.svelte";
export { default as AppTabBarTab } from "./app-tab-bar-tab.svelte";
export { default as AppTabBar } from "./app-tab-bar.svelte";
export { default as AppTabBarGrouped } from "./app-tab-bar-grouped.svelte";
export { default as ProjectTabBar } from "./project-tab-bar.svelte";
export { default as AppPanelsGrouped } from "./app-panels-grouped.svelte";
export { default as AppTopBar } from "./app-top-bar.svelte";
export { default as AppSearchButton } from "./app-search-button.svelte";
export { default as AppSessionItem } from "./app-session-item.svelte";
export { default as AppSidebarProjectGroup } from "./app-sidebar-project-group.svelte";
export { default as AppSidebarLayout } from "./app-sidebar-layout.svelte";
export { default as AppSidebarFooter } from "./app-sidebar-footer.svelte";
export { default as SidebarUpdateCard } from "./sidebar-update-card.svelte";
export {
	DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	SIDEBAR_UPDATE_CARD_VARIANTS,
	getSidebarUpdateCardCopy,
	getSidebarUpdateCardVariantDefinition,
	type SidebarUpdateCardSurfaceTokens,
	type SidebarUpdateCardVariant,
	type SidebarUpdateCardVariantDefinition,
} from "./sidebar-update-card-variants.js";
export { default as ProjectHeader } from "./project-header.svelte";
export { default as ProjectHeaderOverflowMenu } from "./project-header-overflow-menu.svelte";
export { default as ProjectColorSwatch } from "./project-color-swatch.svelte";
export {
	PROJECT_COLOR_OPTIONS,
	type ProjectColorOption,
} from "./project-color-options.js";
export {
	buildProjectHeaderOverflowMenuState,
	getSelectedProjectColorHex,
	type ProjectHeaderOverflowMenuState,
} from "./project-menu-state.js";
export type {
  AppTab,
  AppTabGroup,
  AppTabStatus,
  AppTabMode,
  AppSessionItem as AppSessionItemType,
  AppProjectGroup,
  SidebarUpdateKind,
} from "./types.js";
