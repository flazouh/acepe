import { describe, expect, it } from "vitest";
import { resolveDotmatrixLoaderRoute } from "../dotmatrix/dotmatrix-loader-routing.js";

describe("dotmatrix-loader-routing", () => {
	it("routes arc-spin to the arc spinner", () => {
		expect(resolveDotmatrixLoaderRoute("arc-spin")).toEqual({ kind: "arc" });
	});

	it("routes hex ids to DotmHexSpinner", () => {
		expect(resolveDotmatrixLoaderRoute("dotm-hex-2")).toEqual({
			kind: "hex",
			variant: "dotm-hex-2",
		});
	});

	it("routes dedicated square and triangle spinners", () => {
		expect(resolveDotmatrixLoaderRoute("dotm-square-18")).toEqual({ kind: "square-18" });
		expect(resolveDotmatrixLoaderRoute("dotm-triangle-1")).toEqual({
			kind: "triangle",
			variant: "dotm-triangle-1",
		});
		expect(resolveDotmatrixLoaderRoute("dotm-triangle-17")).toEqual({
			kind: "triangle",
			variant: "dotm-triangle-17",
		});
		expect(resolveDotmatrixLoaderRoute("dotm-triangle-20")).toEqual({
			kind: "triangle",
			variant: "dotm-triangle-20",
		});
	});

	it("routes remaining registry ids to the generic registry loader", () => {
		expect(resolveDotmatrixLoaderRoute("dotm-square-1")).toEqual({
			kind: "registry",
			loaderId: "dotm-square-1",
		});
	});
});
