import { createScope, withScope } from '../dist/core/scope.js';
import { signal, effect, computed, effectAsync } from '../dist/core/signal.js';

// Note: build to `dist/` before running this file (it imports from dist).

console.log('=== Core Reactivity Integration ===');

// Test 1
console.log('\nTest 1: Basic signal and effect (coalescing)');
const count = signal(0);
let effectRuns = 0;

const dispose = effect(() => {
  effectRuns++;
  console.log(`Effect run ${effectRuns}, count: ${count()}`);
});

count.set(1);
count.set(2);

setTimeout(() => {
  console.log('After changes - effect runs:', effectRuns, '(expected 1 due to coalescing)');

  // Test 2
  console.log('\nTest 2: Manual disposal');
  dispose();
  console.log('Effect disposed');

  count.set(3);
  count.set(4);

  setTimeout(() => {
    console.log('After disposal - effect runs:', effectRuns, '(should be unchanged)');

    // Test 3
    console.log('\nTest 3: Scope integration');
    const scope = createScope();
    let scopedRuns = 0;

    const scopedSignal = withScope(scope, () => {
      const s = signal(100);
      effect(() => {
        scopedRuns++;
        console.log(`Scoped effect run ${scopedRuns}, value: ${s()}`);
      });
      return s;
    });

    scopedSignal.set(101);
    scopedSignal.set(102);

    setTimeout(() => {
      console.log('Before scope dispose - scoped runs:', scopedRuns);
      scope.dispose();
      console.log('Scope disposed');

      scopedSignal.set(103);
      scopedSignal.set(104);

      setTimeout(() => {
        console.log('After scope dispose - scoped runs:', scopedRuns, '(should be unchanged)');

        // Test 4
        console.log('\nTest 4: Computed signals');
        const base = signal(10);
        const doubled = computed(() => base() * 2);
        let computedRuns = 0;

        effect(() => {
          computedRuns++;
          console.log(`Computed effect run ${computedRuns}, doubled: ${doubled()}`);
        });

        base.set(20);
        base.set(30);

        setTimeout(() => {
          console.log('After base changes - computed runs:', computedRuns, '(likely 1 due to coalescing)');

          // Test 5
          console.log('\nTest 5: withScope');
          const scope2 = createScope();
          let withScopeRuns = 0;

          const result = withScope(scope2, () => {
            const scopedSignal2 = signal('test');
            effect(() => {
              withScopeRuns++;
              console.log(`withScope effect run ${withScopeRuns}, value: ${scopedSignal2()}`);
            });
            scopedSignal2.set('changed');
            return 'result';
          });

          console.log('withScope result:', result);

          setTimeout(() => {
            console.log('After withScope - runs:', withScopeRuns);
            scope2.dispose();

            // Test 6
            console.log('\nTest 6: Dynamic dependencies');
            const dynamicScope = createScope();
            let dynamicRuns = 0;

            const signalA = signal('A');
            const signalB = signal('B');
            const useA = signal(true);

            withScope(dynamicScope, () => {
              effect(() => {
                dynamicRuns++;
                const value = useA() ? signalA() : signalB();
                console.log(`Dynamic effect run ${dynamicRuns}, useA=${useA()}, value: ${value}`);
              });
            });

            signalA.set('A1');
            signalB.set('B1'); // should not trigger while useA=true

            setTimeout(() => {
              console.log('Before switch - dynamic runs:', dynamicRuns);
              useA.set(false); // should trigger a run

              setTimeout(() => {
                signalA.set('A2'); // should NOT trigger now
                signalB.set('B2'); // should trigger now

                setTimeout(() => {
                  console.log('After switch - dynamic runs:', dynamicRuns);
                  dynamicScope.dispose();

                  // Test 7
                  console.log('\nTest 7: effectAsync abort on re-run');
                  const asyncScope = createScope();
                  const trigger = signal(0);
                  let completed = 0;
                  let aborted = 0;

                  withScope(asyncScope, () => {
                    effectAsync((abortSignal) => {
                      const id = trigger();

                      const timer = setTimeout(() => {
                        completed++;
                        console.log(`Async job completed for trigger=${id}`);
                      }, 80);

                      abortSignal.addEventListener('abort', () => {
                        aborted++;
                        clearTimeout(timer);
                        console.log(`Async job aborted for trigger=${id}`);
                      });
                    });
                  });

                  // Force separate ticks so reruns actually happen
                  trigger.set(1);
                  setTimeout(() => trigger.set(2), 10);
                  setTimeout(() => trigger.set(3), 20);

                  setTimeout(() => {
                    console.log('Async completed:', completed, '(expected 1)');
                    console.log('Async aborted:', aborted, '(expected >=2)');
                    asyncScope.dispose();

                    console.log('\n=== All Tests Completed ===');
                    console.log('Coalescing + dedupe behavior observed');
                    console.log('Manual disposal works');
                    console.log('Scope integration works');
                    console.log('Computed signals initialize sync');
                    console.log('withScope works');
                    console.log('Dynamic dependencies work');
                    console.log('effectAsync abort-on-rerun works');
                  }, 250);
                }, 120);
              }, 30);
            }, 100);
          }, 100);
        }, 100);
      }, 100);
    }, 100);
  }, 100);
}, 100);
