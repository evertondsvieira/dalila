import { signal, computed, initDevTools } from "../../dist/index.js";
import { bind } from "../../dist/runtime/bind.js";

type DemoRow = {
  id: number;
  title: string;
  group: string;
  score: number;
};

const fmt = new Intl.NumberFormat("pt-BR");

const VIEWPORT_HEIGHT = 360;
const ROW_HEIGHT = 40;
const OVERSCAN = 8;
const VIRTUAL_WINDOW_ROWS = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;

initDevTools()

function buildRows(size: number): DemoRow[] {
  const rows: DemoRow[] = [];
  for (let i = 0; i < size; i++) {
    const id = i + 1;
    rows.push({
      id,
      title: `Registro ${id}`,
      group: `grupo-${(i % 32) + 1}`,
      score: (i * 37) % 997,
    });
  }
  return rows;
}

const rows = signal<DemoRow[]>(buildRows(5000));
const buildInfo = signal("Dataset inicial: 5.000 itens.");
const nativeRenderedNowLabel = signal("0");
const virtualRenderedNowLabel = signal("0");

function setDataset(size: number): void {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  rows.set(buildRows(size));
  const end = typeof performance !== "undefined" ? performance.now() : Date.now();
  buildInfo.set(`Gerou ${fmt.format(size)} itens em ${(end - start).toFixed(1)}ms.`);
  scheduleRefresh();
}

const totalRowsLabel = computed(() => fmt.format(rows().length));
const nativeNodeEstimateLabel = computed(() => fmt.format(rows().length));
const virtualNodeEstimateLabel = computed(() => fmt.format(Math.min(rows().length, VIRTUAL_WINDOW_ROWS)));
const virtualWindowLabel = computed(() => fmt.format(VIRTUAL_WINDOW_ROWS));

function refreshRealDomCounters(): void {
  const nativeCount = document.querySelectorAll(".native-viewport .row-native").length;
  const virtualCount = document.querySelectorAll(".virtual-viewport .row-virtual").length;
  nativeRenderedNowLabel.set(fmt.format(nativeCount));
  virtualRenderedNowLabel.set(fmt.format(virtualCount));
}

let refreshScheduled = false;
function scheduleRefresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  requestAnimationFrame(() => {
    refreshScheduled = false;
    refreshRealDomCounters();
  });
}

const ctx = {
  rows,
  buildInfo,
  totalRowsLabel,
  nativeNodeEstimateLabel,
  virtualNodeEstimateLabel,
  virtualWindowLabel,
  nativeRenderedNowLabel,
  virtualRenderedNowLabel,
  load500: () => setDataset(500),
  load5000: () => setDataset(5000),
  load20000: () => setDataset(20000),
};

bind(document.body, ctx);
scheduleRefresh();
document.addEventListener("scroll", scheduleRefresh, true);
window.addEventListener("resize", scheduleRefresh);
