import type { SponsorConfig } from "../types/sponsorConfig";

// 迁移阶段不展示主题自带的收款账号或示例赞助者；确认真实收款信息后再单独启用。
export const sponsorConfig: SponsorConfig = {
	title: "",
	description: "",
	usage: "",
	showSponsorsList: false,
	showComment: false,
	showButtonInPost: false,
	methods: [],
	sponsors: [],
};
