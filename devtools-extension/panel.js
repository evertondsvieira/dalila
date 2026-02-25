const REFRESH_INTERVAL_MS = 700;

const dom = {
  enableButton: document.getElementById("enable-devtools"),
  refreshButton: document.getElementById("refresh"),
  autoRefresh: document.getElementById("autorefresh"),
  highlightUpdates: document.getElementById("highlight-updates"),
  search: document.getElementById("search"),
  profiler: document.getElementById("profiler"),
  profSortP95: document.getElementById("prof-sort-p95"),
  profSortAvg: document.getElementById("prof-sort-avg"),
  profSortRuns: document.getElementById("prof-sort-runs"),
  profWin5s: document.getElementById("prof-win-5s"),
  profWin10s: document.getElementById("prof-win-10s"),
  profWin30s: document.getElementById("prof-win-30s"),
  profFilterEffect: document.getElementById("prof-filter-effect"),
  profFilterEffectAsync: document.getElementById("prof-filter-effectasync"),
  profFilterComputed: document.getElementById("prof-filter-computed"),
  status: document.getElementById("status"),
  stats: document.getElementById("stats"),
  nodes: document.getElementById("nodes"),
  edges: document.getElementById("edges"),
  inspector: document.getElementById("inspector"),
};

const state = {
  snapshot: null,
  previousSnapshot: null,
  selectedNodeId: null,
  lastError: "",
  pollTimer: null,
  bridgeEnabled: false,
  profilerSort: "p95",
  profilerWindowMs: 10000,
  profilerTypeFilter: {
    effect: true,
    effectAsync: true,
    computed: true,
  },
};

function evalInInspectedWindow(source) {
  const browserEval = (typeof browser !== "undefined" && browser?.devtools?.inspectedWindow?.eval)
    ? browser.devtools.inspectedWindow.eval.bind(browser.devtools.inspectedWindow)
    : null;

  if (browserEval) {
    return browserEval(source).then((result) => {
      // Firefox may resolve with [value, exceptionInfo] when promisifying callback APIs.
      if (Array.isArray(result) && result.length >= 2) {
        const [value, exceptionInfo] = result;
        if (exceptionInfo?.isException) {
          throw new Error(exceptionInfo.value || "Evaluation failed in inspected window.");
        }
        return value;
      }
      return result;
    });
  }

  const chromeEval = (typeof chrome !== "undefined" && chrome?.devtools?.inspectedWindow?.eval)
    ? chrome.devtools.inspectedWindow.eval.bind(chrome.devtools.inspectedWindow)
    : null;

  if (!chromeEval) {
    return Promise.reject(new Error("DevTools inspectedWindow API not available."));
  }

  return new Promise((resolve, reject) => {
    chromeEval(source, (result, exceptionInfo) => {
      if (exceptionInfo?.isException) {
        reject(new Error(exceptionInfo.value || "Evaluation failed in inspected window."));
        return;
      }
      resolve(result);
    });
  });
}

function prettyTime(ts) {
  if (!ts) return "-";
  const dt = new Date(ts);
  return dt.toLocaleTimeString();
}

function setStatus(text, mode) {
  dom.status.textContent = text;
  dom.status.className = `status ${mode}`;
}

function clearElement(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function appendMetaSpan(container, text) {
  const span = document.createElement("span");
  span.textContent = text;
  container.append(span);
}

function syncControls() {
  if (dom.enableButton) {
    dom.enableButton.textContent = state.bridgeEnabled ? "Disable Bridge" : "Enable Bridge";
    dom.enableButton.classList.toggle("btn-strong", !state.bridgeEnabled);
  }
  dom.profSortP95?.classList.toggle("btn-strong", state.profilerSort === "p95");
  dom.profSortAvg?.classList.toggle("btn-strong", state.profilerSort === "avg");
  dom.profSortRuns?.classList.toggle("btn-strong", state.profilerSort === "runs");
  dom.profWin5s?.classList.toggle("btn-strong", state.profilerWindowMs === 5000);
  dom.profWin10s?.classList.toggle("btn-strong", state.profilerWindowMs === 10000);
  dom.profWin30s?.classList.toggle("btn-strong", state.profilerWindowMs === 30000);
  if (dom.profFilterEffect) dom.profFilterEffect.checked = !!state.profilerTypeFilter.effect;
  if (dom.profFilterEffectAsync) dom.profFilterEffectAsync.checked = !!state.profilerTypeFilter.effectAsync;
  if (dom.profFilterComputed) dom.profFilterComputed.checked = !!state.profilerTypeFilter.computed;
}

function typeSortWeight(type) {
  switch (type) {
    case "scope":
      return 0;
    case "signal":
      return 1;
    case "computed":
      return 2;
    case "effect":
      return 3;
    case "effectAsync":
      return 4;
    default:
      return 9;
  }
}

function renderStats(snapshot) {
  const byType = {
    scope: 0,
    signal: 0,
    computed: 0,
    effect: 0,
    effectAsync: 0,
  };

  for (const node of snapshot.nodes) {
    if (Object.prototype.hasOwnProperty.call(byType, node.type)) {
      byType[node.type] += 1;
    }
  }

  const entries = [
    ["nodes", snapshot.nodes.length],
    ["edges", snapshot.edges.length],
    ["scopes", byType.scope],
    ["signals", byType.signal + byType.computed],
    ["effects", byType.effect + byType.effectAsync],
    ["events", snapshot.events.length],
  ];

  clearElement(dom.stats);
  for (const [label, value] of entries) {
    const card = document.createElement("article");
    card.className = "stat";

    const labelEl = document.createElement("p");
    labelEl.className = "label";
    labelEl.textContent = label;

    const valueEl = document.createElement("p");
    valueEl.className = "value";
    valueEl.textContent = String(value);

    card.append(labelEl, valueEl);
    dom.stats.append(card);
  }
}

function renderNodes(snapshot) {
  const term = dom.search.value.trim().toLowerCase();

  const nodes = [...snapshot.nodes].sort((a, b) => {
    const typeDelta = typeSortWeight(a.type) - typeSortWeight(b.type);
    if (typeDelta !== 0) return typeDelta;
    return a.id - b.id;
  });

  const filtered = !term
    ? nodes
    : nodes.filter((node) => {
        const text = `${node.type} ${node.id} ${node.label}`.toLowerCase();
        return text.includes(term);
      });

  clearElement(dom.nodes);

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "row";
    empty.textContent = "No nodes match your filter.";
    dom.nodes.append(empty);
    return;
  }

  for (const node of filtered) {
    const row = document.createElement("div");
    row.className = "row";
    if (node.id === state.selectedNodeId) row.classList.add("selected");

    const disposed = node.disposed ? "disposed" : "active";

    const head = document.createElement("div");
    head.className = "row-head";
    const strong = document.createElement("strong");
    strong.textContent = `#${node.id} ${node.type}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = disposed;
    head.append(strong, badge);

    const meta = document.createElement("div");
    meta.className = "meta";
    appendMetaSpan(meta, `reads:${node.reads}`);
    appendMetaSpan(meta, `writes:${node.writes}`);
    appendMetaSpan(meta, `runs:${node.runs}`);

    row.append(head, meta);

    row.addEventListener("click", () => {
      state.selectedNodeId = node.id;
      render(snapshot);
      if (dom.highlightUpdates?.checked) {
        highlightNodeInInspectedPage(node.id, 900);
      }
    });

    dom.nodes.append(row);
  }
}

function sortProfilerRows(rows) {
  const sortKey = state.profilerSort;
  return [...rows].sort((a, b) => {
    if (sortKey === "runs") {
      if (b.runs !== a.runs) return b.runs - a.runs;
      if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
      return a.id - b.id;
    }
    if (sortKey === "avg") {
      if (b.avgMs !== a.avgMs) return b.avgMs - a.avgMs;
      if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
      return a.id - b.id;
    }
    if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
    if (b.avgMs !== a.avgMs) return b.avgMs - a.avgMs;
    return a.id - b.id;
  });
}

function renderProfiler(snapshot) {
  clearElement(dom.profiler);

  const rows = Array.isArray(snapshot.profiler?.nodes) ? snapshot.profiler.nodes : [];
  const filteredRows = rows.filter((sample) => {
    const node = snapshot.nodes.find((entry) => entry.id === sample.id);
    if (!node) return true;
    if (node.type === "effect") return !!state.profilerTypeFilter.effect;
    if (node.type === "effectAsync") return !!state.profilerTypeFilter.effectAsync;
    if (node.type === "computed") return !!state.profilerTypeFilter.computed;
    return true;
  });
  if (filteredRows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "row";
    empty.textContent = snapshot.profiler?.enabled
      ? "No profiler rows match the current filters yet."
      : "Profiler disabled.";
    dom.profiler.append(empty);
    return;
  }

  for (const sample of sortProfilerRows(filteredRows)) {
    const node = snapshot.nodes.find((entry) => entry.id === sample.id);
    const row = document.createElement("div");
    row.className = "prof-row";
    if (sample.id === state.selectedNodeId) row.classList.add("selected");

    const head = document.createElement("div");
    head.className = "row-head";

    const title = document.createElement("strong");
    title.textContent = node
      ? `#${sample.id} ${node.type}${node.label ? ` · ${node.label}` : ""}`
      : `#${sample.id}`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${sample.runs} runs`;
    head.append(title, badge);

    const grid = document.createElement("div");
    grid.className = "prof-grid";
    appendMetaSpan(grid, `avg:${sample.avgMs}ms`);
    appendMetaSpan(grid, `p95:${sample.p95Ms}ms`);
    appendMetaSpan(grid, `max:${sample.maxMs}ms`);
    appendMetaSpan(grid, `last:${sample.lastMs}ms`);

    row.append(head, grid);
    row.addEventListener("click", () => {
      state.selectedNodeId = sample.id;
      render(snapshot);
      if (dom.highlightUpdates?.checked) {
        highlightNodeInInspectedPage(sample.id, 900);
      }
    });

    dom.profiler.append(row);
  }
}

function changedNodes(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot || !nextSnapshot) return [];

  const previousById = new Map();
  for (const node of previousSnapshot.nodes) previousById.set(node.id, node);

  const changed = [];
  for (const node of nextSnapshot.nodes) {
    const prev = previousById.get(node.id);
    if (!prev) continue;

    const writesDelta = Math.max(0, node.writes - prev.writes);
    const runsDelta = Math.max(0, node.runs - prev.runs);
    if (writesDelta === 0 && runsDelta === 0) continue;

    changed.push({
      id: node.id,
      type: node.type,
      writesDelta,
      runsDelta,
      score: writesDelta * 2 + runsDelta,
    });
  }

  // Reduce visual noise:
  // - Effects are closest to actual DOM update points.
  // - Cap highlights per refresh tick.
  return changed
    .filter((entry) => entry.type === "effect" || entry.type === "effectAsync")
    .sort((a, b) => (b.score === a.score ? a.id - b.id : b.score - a.score))
    .slice(0, 8)
    .map((entry) => entry.id);
}

async function highlightNodeInInspectedPage(nodeId, durationMs = 600) {
  if (typeof nodeId !== "number" || !Number.isFinite(nodeId)) return false;

  const expression = `(() => {
    const hook = globalThis.__DALILA_DEVTOOLS__;
    if (!hook || typeof hook.highlightNode !== "function") return false;
    return !!hook.highlightNode(${nodeId}, { durationMs: ${Math.max(120, Math.floor(durationMs))} });
  })();`;

  try {
    return Boolean(await evalInInspectedWindow(expression));
  } catch {
    return false;
  }
}

async function highlightUpdatesInInspectedPage(nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return;

  const unique = [...new Set(nodeIds)].filter((id) => typeof id === "number");
  if (unique.length === 0) return;

  const expression = `(() => {
    const hook = globalThis.__DALILA_DEVTOOLS__;
    if (!hook || typeof hook.highlightNode !== "function") return 0;
    let hits = 0;
    for (const id of ${JSON.stringify(unique)}) {
      if (hook.highlightNode(id, { durationMs: 380 })) {
        hits++;
        if (hits >= 6) break;
      }
    }
    return hits;
  })();`;

  try {
    await evalInInspectedWindow(expression);
  } catch {
    // Best effort only.
  }
}

function renderEdges(snapshot) {
  clearElement(dom.edges);

  const deps = snapshot.edges
    .filter((edge) => edge.kind === "dependency")
    .sort((a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  if (deps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "row";
    empty.textContent = "No dependency edges captured yet.";
    dom.edges.append(empty);
    return;
  }

  for (const edge of deps) {
    const from = snapshot.nodes.find((node) => node.id === edge.from);
    const to = snapshot.nodes.find((node) => node.id === edge.to);

    const row = document.createElement("div");
    row.className = "row";

    const head = document.createElement("div");
    head.className = "row-head";
    const strong = document.createElement("strong");
    strong.textContent = `#${edge.from} -> #${edge.to}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = edge.kind;
    head.append(strong, badge);

    const meta = document.createElement("div");
    meta.className = "meta";
    appendMetaSpan(meta, from ? from.type : "?");
    appendMetaSpan(meta, to ? to.type : "?");

    row.append(head, meta);
    dom.edges.append(row);
  }
}

function renderInspector(snapshot) {
  const node = snapshot.nodes.find((entry) => entry.id === state.selectedNodeId);

  if (!node) {
    dom.inspector.className = "inspector empty";
    dom.inspector.textContent = "Select a node to inspect details.";
    return;
  }

  const incomingDeps = snapshot.edges.filter((edge) => edge.kind === "dependency" && edge.to === node.id);
  const outgoingDeps = snapshot.edges.filter((edge) => edge.kind === "dependency" && edge.from === node.id);
  const ownershipIn = snapshot.edges.filter((edge) => edge.kind === "ownership" && edge.to === node.id);
  const ownershipOut = snapshot.edges.filter((edge) => edge.kind === "ownership" && edge.from === node.id);

  const detail = {
    node,
    profiler: snapshot.profiler?.nodes?.find((entry) => entry.id === node.id) ?? null,
    relations: {
      incomingDeps: incomingDeps.map((edge) => edge.from),
      outgoingDeps: outgoingDeps.map((edge) => edge.to),
      ownerScopes: ownershipIn.map((edge) => edge.from),
      ownedNodes: ownershipOut.map((edge) => edge.to),
    },
    recentEvents: snapshot.events.slice(-8),
  };

  dom.inspector.className = "inspector";
  clearElement(dom.inspector);
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(detail, null, 2);
  dom.inspector.append(pre);
}

function render(snapshot) {
  renderStats(snapshot);
  renderNodes(snapshot);
  renderProfiler(snapshot);
  renderEdges(snapshot);
  renderInspector(snapshot);
}

async function fetchSnapshot() {
  const expression = `(() => {
    const hook = globalThis.__DALILA_DEVTOOLS__;
    if (!hook) return { ok: false, reason: "missing_hook" };

    if (typeof hook.getSnapshot !== "function") {
      return { ok: false, reason: "invalid_hook" };
    }

    try {
      return { ok: true, snapshot: hook.getSnapshot() };
    } catch (error) {
      return { ok: false, reason: "get_snapshot_failed", message: String(error) };
    }
  })();`;

  return evalInInspectedWindow(expression);
}

async function enableBridge() {
  const expression = `(() => {
    const hook = globalThis.__DALILA_DEVTOOLS__;
    if (!hook || typeof hook.setEnabled !== "function") return { ok: false, reason: "missing_hook" };
    hook.setEnabled(true, { exposeGlobalHook: true, dispatchEvents: true });
    if (typeof hook.setProfilerEnabled === "function") {
      hook.setProfilerEnabled(true, { windowMs: ${Math.max(1000, Math.floor(state.profilerWindowMs))}, samplesPerNode: 128 });
    }
    return { ok: true };
  })();`;

  return evalInInspectedWindow(expression);
}

async function updateProfilerConfig() {
  if (!state.bridgeEnabled) return;
  const expression = `(() => {
    const hook = globalThis.__DALILA_DEVTOOLS__;
    if (!hook || typeof hook.setProfilerEnabled !== "function") return { ok: false };
    hook.setProfilerEnabled(true, { windowMs: ${Math.max(1000, Math.floor(state.profilerWindowMs))}, samplesPerNode: 128 });
    return { ok: true };
  })();`;
  try {
    await evalInInspectedWindow(expression);
  } catch {
    // best effort; UI can keep local state and refresh later
  }
}

async function disableBridge() {
  const expression = `(() => {
    const hook = globalThis.__DALILA_DEVTOOLS__;
    if (!hook || typeof hook.setEnabled !== "function") return { ok: false, reason: "missing_hook" };
    if (typeof hook.setProfilerEnabled === "function") {
      hook.setProfilerEnabled(false);
    }
    hook.setEnabled(false);
    return { ok: true };
  })();`;

  return evalInInspectedWindow(expression);
}

async function refresh() {
  try {
    const result = await fetchSnapshot();

    if (!result || !result.ok) {
      state.snapshot = null;
      state.bridgeEnabled = false;
      const reason = result?.reason || "unknown";
      state.lastError = reason;

      const missingHelp = [
        "Dalila bridge not found on the inspected page.",
        "Call initDevTools() in your app runtime:",
        "await initDevTools();",
      ].join(" ");

      if (reason === "missing_hook") {
        setStatus(missingHelp, "warn");
      } else {
        setStatus(`Devtools unavailable: ${reason}`, "warn");
      }

      clearElement(dom.stats);
      clearElement(dom.nodes);
      clearElement(dom.profiler);
      clearElement(dom.edges);
      dom.inspector.className = "inspector empty";
      dom.inspector.textContent = "No data. Enable Devtools in the inspected app.";
      state.previousSnapshot = null;
      syncControls();
      return;
    }

    const previousSnapshot = state.snapshot;
    state.snapshot = result.snapshot;
    state.previousSnapshot = previousSnapshot;
    state.bridgeEnabled = !!result.snapshot?.enabled;
    state.lastError = "";

    const stamp = prettyTime(Date.now());
    const nodes = state.snapshot.nodes.length;
    const deps = state.snapshot.edges.filter((edge) => edge.kind === "dependency").length;
    setStatus(`Connected. ${nodes} nodes, ${deps} dependencies. Updated ${stamp}.`, "ok");

    if (state.selectedNodeId !== null) {
      const exists = state.snapshot.nodes.some((node) => node.id === state.selectedNodeId);
      if (!exists) state.selectedNodeId = null;
    }

    render(state.snapshot);
    syncControls();

    if (dom.highlightUpdates?.checked) {
      const changed = changedNodes(state.previousSnapshot, state.snapshot);
      if (changed.length > 0) {
        highlightUpdatesInInspectedPage(changed);
      }
    }
  } catch (error) {
    const message = String(error);
    state.lastError = message;
    setStatus(`Error: ${message}`, "warn");
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (!dom.autoRefresh.checked) return;
    refresh();
  }, REFRESH_INTERVAL_MS);
}

function stopPolling() {
  if (!state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function bootstrap() {
  dom.refreshButton.addEventListener("click", async () => {
    await refresh();
    if (state.snapshot) {
      setStatus(`Manual refresh at ${prettyTime(Date.now())}.`, "ok");
    }
  });
  dom.search.addEventListener("input", () => {
    if (state.snapshot) render(state.snapshot);
  });

  const setProfilerSort = (sort) => {
    state.profilerSort = sort;
    syncControls();
    if (state.snapshot) render(state.snapshot);
  };
  dom.profSortP95?.addEventListener("click", () => setProfilerSort("p95"));
  dom.profSortAvg?.addEventListener("click", () => setProfilerSort("avg"));
  dom.profSortRuns?.addEventListener("click", () => setProfilerSort("runs"));
  const setProfilerWindow = async (windowMs) => {
    state.profilerWindowMs = windowMs;
    syncControls();
    await updateProfilerConfig();
    if (state.snapshot) await refresh();
  };
  dom.profWin5s?.addEventListener("click", () => setProfilerWindow(5000));
  dom.profWin10s?.addEventListener("click", () => setProfilerWindow(10000));
  dom.profWin30s?.addEventListener("click", () => setProfilerWindow(30000));

  const onFilterChange = () => {
    state.profilerTypeFilter.effect = !!dom.profFilterEffect?.checked;
    state.profilerTypeFilter.effectAsync = !!dom.profFilterEffectAsync?.checked;
    state.profilerTypeFilter.computed = !!dom.profFilterComputed?.checked;
    if (state.snapshot) render(state.snapshot);
  };
  dom.profFilterEffect?.addEventListener("change", onFilterChange);
  dom.profFilterEffectAsync?.addEventListener("change", onFilterChange);
  dom.profFilterComputed?.addEventListener("change", onFilterChange);

  dom.enableButton.addEventListener("click", async () => {
    try {
      const result = state.bridgeEnabled ? await disableBridge() : await enableBridge();
      if (!result?.ok) {
        setStatus("Unable to change bridge state. Did you call initDevTools() in app code?", "warn");
        return;
      }
      await refresh();
      setStatus(`Bridge ${state.bridgeEnabled ? "enabled" : "disabled"}.`, "ok");
    } catch (error) {
      setStatus(`Bridge toggle failed: ${String(error)}`, "warn");
    }
  });

  dom.autoRefresh.addEventListener("change", () => {
    if (dom.autoRefresh.checked && state.snapshot) {
      refresh();
    }
  });

  dom.highlightUpdates?.addEventListener("change", () => {
    if (!dom.highlightUpdates.checked) {
      evalInInspectedWindow(`(() => {
        const hook = globalThis.__DALILA_DEVTOOLS__;
        if (hook && typeof hook.clearHighlights === "function") hook.clearHighlights();
        return true;
      })();`).catch(() => {});
      setStatus("Highlight updates disabled.", "ok");
    } else {
      setStatus("Highlight updates enabled.", "ok");
    }
  });

  syncControls();
  startPolling();
  await refresh();
}

window.addEventListener("beforeunload", () => {
  stopPolling();
});

bootstrap();
