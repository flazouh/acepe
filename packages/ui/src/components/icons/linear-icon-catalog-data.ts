import { linearIconData } from "./linear-icon-catalog.generated.js";
import type { LinearIconName } from "./linear-icon-name.js";

export type LinearIconCatalogData = (typeof linearIconData)[LinearIconName];
