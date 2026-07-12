import { describe, expect, it } from "bun:test";

import { extractIconsFromCacheEntry } from "../extract-svg-sources.js";
import { cleanIconName } from "../name-utils.js";
import { sharedBundleIconOriginalName } from "../use-is-mounted-icons.js";

const useIsMountedFixture = [
	"function bm(e){return(0,x.jsx)(U,{...e,children:(0,x.jsx)(`svg`,{children:(0,x.jsx)(`path`,{d:`M6.75 1V6.75`})})})}",
	"function XY(e){return(0,x.jsx)(U,{...e,children:(0,x.jsx)(`svg`,{children:(0,x.jsx)(`path`,{d:`M11.48 10.326`})})})}",
	"function EJ(e){return(0,x.jsx)(U,{...e,children:(0,x.jsx)(`svg`,{children:(0,x.jsx)(`path`,{d:`M10.25 12.2988`})})})}",
	"function bigIllustration(e){return(0,x.jsx)(U,{...e,children:(0,x.jsx)(`svg`,{viewBox:`0 0 512 512`,children:(0,x.jsx)(`path`,{d:`M0 0h512v512H0z`})})})}",
].join("\n");

describe("useIsMounted shared bundle extraction", () => {
	it("names mapped functions with semantic icon ids", () => {
		expect(sharedBundleIconOriginalName("bm")).toBe("CopyIcon");
		expect(sharedBundleIconOriginalName("XY")).toBe("ChevronUpIcon");
		expect(sharedBundleIconOriginalName("mJ")).toBe("CheckIcon");
		expect(sharedBundleIconOriginalName("i0")).toBe("SkillsIcon");
		expect(cleanIconName("ChevronUpIcon")).toBe("chevron-up");
	});

	it("extracts compact shared-bundle icons from useIsMounted chunks", () => {
		const icons = extractIconsFromCacheEntry(
			"useIsMounted.KmPRpoey.js",
			useIsMountedFixture,
		);
		const sharedIcons = icons.filter(
			(icon) => icon.sourceType === "shared-jsx",
		);
		const originalNames = sharedIcons.map((icon) => icon.originalName);

		expect(originalNames).toContain("CopyIcon");
		expect(originalNames).toContain("ChevronUpIcon");
		expect(originalNames).toContain("PlayIcon");
		expect(originalNames).not.toContain("SharedJsxbigIllustrationIcon");
	});

	it("names Linear's RegisterAction display-options component", () => {
		const icons = extractIconsFromCacheEntry(
			"RegisterAction.C5Xf5mWh.js",
			"function wt(e){return(0,x.jsx)(U,{...e,children:(0,x.jsx)(`svg`,{children:(0,x.jsx)(`path`,{d:`M7 2.5H14.75`})})})}",
		);

		expect(
			icons.some(
				(icon) =>
					icon.sourceType === "shared-jsx" &&
					icon.originalName === "DisplayOptionsIcon",
			),
		).toBe(true);
	});

	it("names Linear's EditorActions edit component", () => {
		const icons = extractIconsFromCacheEntry(
			"EditorActions.Ciyb75qA.js",
			"function Xa(e){return(0,x.jsx)(U,{...e,children:(0,x.jsx)(`svg`,{children:(0,x.jsx)(`path`,{d:`M10.1805 3.34195L4.14166 9.416`})})})}",
		);

		expect(
			icons.some(
				(icon) =>
					icon.sourceType === "shared-jsx" &&
					icon.originalName === "EditIcon",
			),
		).toBe(true);
	});
});
