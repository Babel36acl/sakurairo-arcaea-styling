import type { GalleryConfig } from "@/types/galleryConfig";

// 相册只展示已经核对过的真实内容；迁移阶段不注册主题自带的示例相册。
export const galleryConfig: GalleryConfig = {
	albums: [],
	columnWidth: 240,
};
