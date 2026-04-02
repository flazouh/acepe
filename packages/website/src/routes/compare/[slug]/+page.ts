import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { getComparison } from "$lib/compare/data.js";

export const load: PageLoad = ({ params }) => {
	const comparison = getComparison(params.slug);
	if (!comparison) {
		error(404, { message: `No comparison found for "${params.slug}"` });
	}
	return { comparison };
};
