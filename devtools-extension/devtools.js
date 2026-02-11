const devtoolsApi =
  (typeof browser !== "undefined" && browser?.devtools?.panels)
    ? browser.devtools.panels
    : (typeof chrome !== "undefined" ? chrome?.devtools?.panels : undefined);

if (!devtoolsApi || typeof devtoolsApi.create !== "function") {
  console.error("[Dalila Devtools] DevTools API not available in this browser.");
} else if (typeof browser !== "undefined" && browser?.devtools?.panels?.create) {
  browser.devtools.panels.create("Dalila", "", "panel.html").catch((error) => {
    console.error("[Dalila Devtools] Failed to create panel:", error);
  });
} else {
  devtoolsApi.create("Dalila", "", "panel.html");
}
