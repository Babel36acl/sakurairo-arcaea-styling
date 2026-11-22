import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";

// 友链页面的正文仍可写在 src/content/spec/friends.mdx；只有核对过的友链才加入此列表。
export const friendsPageConfig: FriendsPageConfig = {
	title: "",
	description: "",
	showCustomContent: true,
	showComment: true,
	randomizeSort: false,
};

export const friendsConfig: FriendLink[] = [];

export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);
	return friendsPageConfig.randomizeSort
		? friends.sort(() => Math.random() - 0.5)
		: friends.sort((a, b) => b.weight - a.weight);
};
