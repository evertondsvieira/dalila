export {};

declare global {
  // Helpers for tests that temporarily patch globals with JSDOM/polyfills.
  // We keep these permissive because many test files dynamically assign/delete.
  // The production typings remain strict in src/.
  interface GlobalThis {
    window?: any;
    document?: any;
    history?: any;
    location?: any;
    Node?: any;
    Element?: any;
    HTMLElement?: any;
    DocumentFragment?: any;
    NodeFilter?: any;
    MouseEvent?: any;
    MutationObserver?: any;
    ResizeObserver?: any;
    requestAnimationFrame?: any;
    cancelAnimationFrame?: any;
    scrollTo?: any;
    IntersectionObserver?: any;
  }
}
