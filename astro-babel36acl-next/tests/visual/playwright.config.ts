import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /.*\.spec\.ts/,
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	workers: 1,
	use: {
		browserName: "chromium",
		colorScheme: "dark",
		locale: "zh-CN",
		timezoneId: "Asia/Shanghai",
		deviceScaleFactor: 1,
		headless: process.env.VISUAL_HEADED !== "1",
		serviceWorkers: "block",
		screenshot: "off",
		video: "off",
		trace: "off",
	},
	projects: [
		{
			name: "visual-chromium",
			use: { browserName: "chromium" },
		},
	],
});
