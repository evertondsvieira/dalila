import { createScope, withScope } from '../dist/core/scope.js';
import { signal, effect, computed, effectAsync } from '../dist/core/signal.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function logStep(title) {
  console.log(`\n=== ${title} ===`);
}

async function testCoalescedEffect() {
  logStep('Coalescing: multiple updates in one effect');
  const count = signal(0);
  let runs = 0;

  const dispose = effect(() => {
    runs++;
    console.log(`Coalesced effect run #${runs}, value: ${count()}`);
  });

  count.set(1);
  count.set(2);
  await tick(30);

  console.log('Expected runs: 1 | observed:', runs);
  dispose();
}

async function testManualDisposal() {
  logStep('Manual disposal stops the effect');
  const count = signal(0);
  let runs = 0;

  const dispose = effect(() => {
    runs++;
    console.log(`Manual effect run #${runs}, value: ${count()}`);
  });

  count.set(1);
  count.set(2);
  await tick(30);

  dispose();
  count.set(3);
  count.set(4);
  await tick(30);

  console.log('After dispose, run count remains at:', runs);
}

async function testScopeLifecycle() {
  logStep('Scope disposal stops nested effects');
  const scope = createScope();
  let scopedRuns = 0;

  const scopedSignal = withScope(scope, () => {
    const s = signal(100);
    effect(() => {
      scopedRuns++;
      console.log(`Scoped effect run #${scopedRuns}, s=${s()}`);
    });
    return s;
  });

  scopedSignal.set(101);
  scopedSignal.set(102);
  await tick(30);

  console.log('Before scope dispose:', scopedRuns);
  scope.dispose();
  console.log('Scope disposed');

  scopedSignal.set(103);
  scopedSignal.set(104);
  await tick(30);
  console.log('After disposing scope, run count stays at:', scopedRuns);
}

async function testComputedSignals() {
  logStep('Computed reruns when dependencies change');
  const base = signal(10);
  const doubled = computed(() => base() * 2);
  let computedRuns = 0;

  const dispose = effect(() => {
    computedRuns++;
    console.log(`Computed run #${computedRuns}, value: ${doubled()}`);
  });

  base.set(20);
  base.set(30);
  await tick(30);

  console.log('Computed runs observed:', computedRuns);
  dispose();
}

async function testWithScopeHelper() {
  logStep('withScope creates a temporary scope');
  const scope = createScope();
  let runs = 0;

  const result = withScope(scope, () => {
    const local = signal('original');
    effect(() => {
      runs++;
      console.log(`withScope effect run #${runs}, value: ${local()}`);
    });
    local.set('changed');
    return 'result from scoped execution';
  });

  await tick(30);
  console.log('withScope returned:', result);
  scope.dispose();
}

async function testDynamicDependencies() {
  logStep('Dynamic dependencies track active signal');
  const signalA = signal('A');
  const signalB = signal('B');
  const useA = signal(true);
  const dynamicScope = createScope();
  let dynamicRuns = 0;

  withScope(dynamicScope, () => {
    effect(() => {
      dynamicRuns++;
      const value = useA() ? signalA() : signalB();
      console.log(`Dynamic dependency run #${dynamicRuns}, useA=${useA()}, value=${value}`);
    });
  });

  signalA.set('A1');
  signalB.set('B1');
  await tick(30);

  useA.set(false);
  await tick(30);

  signalA.set('A2');
  signalB.set('B2');
  await tick(30);

  console.log('Total dynamic runs:', dynamicRuns);
  dynamicScope.dispose();
}

async function testEffectAsyncAbortBehavior() {
  logStep('effectAsync aborts previous executions');
  const asyncScope = createScope();
  const trigger = signal(0);
  let completed = 0;
  let aborted = 0;

  withScope(asyncScope, () => {
    effectAsync((abortSignal) => {
      const id = trigger();
      console.log(`effectAsync started for trigger=${id}`);
      const timer = setTimeout(() => {
        completed++;
        console.log(`effectAsync completed for trigger=${id}`);
      }, 80);

      abortSignal.addEventListener('abort', () => {
        aborted++;
        clearTimeout(timer);
        console.log(`effectAsync aborted for trigger=${id}`);
      });
    });
  });

  trigger.set(1);
  await tick(10);
  trigger.set(2);
  await tick(10);
  trigger.set(3);
  await tick(250);

  console.log('effectAsync completions:', completed);
  console.log('effectAsync aborts:', aborted);
  asyncScope.dispose();
}

async function runIntegrationTests() {
  console.log('=== Core Reactivity Integration ===');
  await testCoalescedEffect();
  await testManualDisposal();
  await testScopeLifecycle();
  await testComputedSignals();
  await testWithScopeHelper();
  await testDynamicDependencies();
  await testEffectAsyncAbortBehavior();
  console.log('\n=== Integration complete ===');
}

runIntegrationTests().catch((err) => {
  console.error('Unexpected error during integration tests:', err);
});
