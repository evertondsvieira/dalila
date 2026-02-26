export function toRenderedNodes(content) {
    return Array.isArray(content) ? content : [content];
}
export function mountRenderedContent(mountToOutlet, content) {
    mountToOutlet(...toRenderedNodes(content));
}
export function renderWrappedBoundary(options) {
    const { matchStack, ctx, content, leafIndex, wrapWithLayouts, mountToOutlet } = options;
    const wrapped = wrapWithLayouts(matchStack, ctx, content, [], leafIndex, true);
    mountRenderedContent(mountToOutlet, wrapped);
}
