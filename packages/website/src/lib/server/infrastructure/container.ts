import { ReportsApplicationService } from "../application/ReportsApplicationService";
import { CommentRepositoryImpl } from "./repositories/CommentRepositoryImpl";
import { FollowerRepositoryImpl } from "./repositories/FollowerRepositoryImpl";
import { ReportRepositoryImpl } from "./repositories/ReportRepositoryImpl";
import { VoteRepositoryImpl } from "./repositories/VoteRepositoryImpl";

let reportsService: ReportsApplicationService | undefined;

export const container = {
	getReportsService(): ReportsApplicationService {
		if (!reportsService) {
			reportsService = new ReportsApplicationService(
				new ReportRepositoryImpl(),
				new CommentRepositoryImpl(),
				new VoteRepositoryImpl(),
				new FollowerRepositoryImpl()
			);
		}
		return reportsService;
	},
};
