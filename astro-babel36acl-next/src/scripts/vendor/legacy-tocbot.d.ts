declare const tocbot: {
	init(options: { tocSelector: string; contentSelector: string; headingSelector: string; headingsOffset: number; onClick: null }): void;
	destroy(): void;
	refresh(): void;
};
export default tocbot;
