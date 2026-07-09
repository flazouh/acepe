import { dropdownMenuItemListGapClass } from "../dropdown-menu/dropdown-menu-item.classes.js";

/** Shared surface for selector panels with optional search (attach menu, branch picker, etc.). */
export const selectorPanelContentClass =
	"w-72 max-w-[18rem] !max-h-none h-auto overflow-y-auto !p-1";

export const selectorPanelBodyClass = `flex h-auto flex-col ${dropdownMenuItemListGapClass} pb-0`;

export const selectorPanelFilterRowClass = "px-1 pb-0.5 pt-0";

export const selectorPanelFilterInputClass =
	"h-6 w-full border-none bg-transparent px-0 py-0 text-xs leading-snug text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none";

export const selectorPanelListClass = `flex max-h-72 flex-col ${dropdownMenuItemListGapClass} overflow-y-auto pl-2 pr-1 pt-0 pb-1`;

export const selectorPanelItemClass = "cursor-pointer rounded-lg px-2 py-1";

export const selectorPanelEmptyStateClass =
	"px-2.5 py-2 text-center text-sm text-muted-foreground";

export const selectorPanelSubmenuContentClass =
	"w-80 max-w-[20rem] !max-h-72 h-auto overflow-y-auto !p-0";
