import {
  signal,
  computed,
  effect,
  batch,
  createScope,
  withScope,
  createList,
  createResource,
  createQueryClient,
  createMutation,
  createContext,
  provide,
  inject,
  match,
  key,
  persist,
  initDevTools,
} from 'dalila';

// ============================================
// Theme Context + Persist
// ============================================
type Theme = 'dark' | 'light';
const ThemeContext = createContext<{ theme: () => Theme; toggle: () => void }>('theme');

export async function createController() {
  await initDevTools();

  const scope = createScope();

  return withScope(scope, () => {
    // ============================================
    // Context: Theme Provider (persisted with auto-preload)
    // ============================================
    const theme = persist(
      signal<Theme>('dark'),
      {
        name: 'app-theme',
        preload: true  // ← dev-server auto-injects preload script
      }
    );

    const themeName = computed(() => theme() === 'dark' ? 'Dark' : 'Light');
    const themeIcon = computed(() => theme() === 'dark' ? '🌙' : '☀️');

    const toggleTheme = () => {
      theme.update(t => t === 'dark' ? 'light' : 'dark');
    };

    // Apply theme to DOM
    effect(() => {
      document.documentElement.setAttribute('data-theme', theme());
    });

    // Provide theme context
    provide(ThemeContext, { theme, toggle: toggleTheme });

    // ============================================
    // Counter (Signals + Computed)
    // ============================================
    const counter = signal(0);
    const doubled = computed(() => counter() * 2);
    const counterStatus = computed(() => {
      const n = counter();
      if (n === 0) return 'Click the buttons to change the value';
      if (n > 0) return `${n} is ${n % 2 === 0 ? 'even' : 'odd'}`;
      return `Negative: ${n}`;
    });

    const increment = () => counter.update(n => n + 1);
    const decrement = () => counter.update(n => n - 1);

    // ============================================
    // Effect: Render counter
    // ============================================
    const renderCount = signal(0);

    effect(() => {
      // Track counter changes
      counter();
      // Increment render count (without tracking)
      renderCount.set(renderCount.peek() + 1);
    });

    // ============================================
    // Batch: Group updates
    // ============================================
    const batchMessage = signal('Updates are batched into single render');

    const runBatch = () => {
      const before = renderCount.peek();

      batch(() => {
        // These 10 updates will cause only 1 render
        for (let i = 0; i < 10; i++) {
          counter.update(n => n + 1);
        }
      });

      // Show message
      const after = renderCount.peek();
      batchMessage.set(`10 updates → ${after - before} render(s)`);
    };

    // ============================================
    // Conditional (when)
    // ============================================
    const isVisible = signal(true);
    const isHidden = computed(() => !isVisible());
    const toggleVisible = () => isVisible.update(v => !v);

    // ============================================
    // Pattern Matching (match)
    // ============================================
    const matchState = computed(() => {
      const n = counter();
      if (n === 0) return 'zero';
      if (n > 0) return 'positive';
      return 'negative';
    });

    const createMatchContent = (emoji: string, label: string, detail: string) => {
      const container = document.createElement('div');
      container.innerHTML = `
        <span class="match-indicator">${emoji}</span>
        <div>
          <div class="match-label">${label}</div>
          <div class="match-detail">${detail}</div>
        </div>
      `;
      return container;
    };

    const matchFragment = match(() => matchState(), {
      zero: () => createMatchContent('⚪', 'Zero', 'The counter is at rest'),
      positive: () => createMatchContent('🟢', 'Positive', `Value: ${counter()}`),
      negative: () => createMatchContent('🔴', 'Negative', `Value: ${counter()}`),
      _: () => createMatchContent('❓', 'Unknown', 'Unexpected state'),
    });

    // ============================================
    // List (createList)
    // ============================================
    const items = signal(['Item 1', 'Item 2', 'Item 3']);
    const listCount = computed(() => items().length);

    const addItem = () => {
      items.update(arr => [...arr, `Item ${arr.length + 1}`]);
    };

    // ============================================
    // Scopes
    // ============================================
    const scopeActive = signal(false);
    const scopeMessage = signal('Click to start a scoped timer');

    const runScopeDemo = () => {
      if (scopeActive()) return;

      scopeActive.set(true);
      scopeMessage.set('Timer started...');

      const demoScope = createScope();
      let tick = 0;

      const intervalId = setInterval(() => {
        tick++;
        scopeMessage.set(`Tick ${tick}...`);
      }, 500);

      demoScope.onCleanup(() => {
        clearInterval(intervalId);
        scopeActive.set(false);
        scopeMessage.set(`Cleaned up after ${tick} ticks`);
      });

      // Auto-dispose after 3 seconds
      setTimeout(() => demoScope.dispose(), 3000);
    };

    // ============================================
    // Resource (data fetching)
    // ============================================
    const rabbitResource = createResource(async (signal) => {
      const res = await fetch('/api/rabbit', { signal });
      if (!res.ok) throw new Error('Failed to fetch rabbit');
      const data = await res.json();
      const url = typeof data?.url === 'string' ? data.url : '';
      const id = data?._id ?? data?.urlId ?? '';
      return { url, id };
    });

    const dataLoading = computed(() => rabbitResource.loading());
    const dataReady = computed(() => !rabbitResource.loading() && !rabbitResource.error());
    const dataError = computed(() => !!rabbitResource.error());
    const rabbitImageUrl = computed(() => rabbitResource.data()?.url ?? '');
    const rabbitAlt = computed(() => (rabbitResource.data()?.id ? `Rabbit ${rabbitResource.data()?.id}` : 'Random rabbit'));
    const dataErrorMsg = computed(() => rabbitResource.error()?.message ?? '');

    const rabbitImgEl = document.querySelector<HTMLImageElement>('#rabbit-img');
    effect(() => {
      if (!rabbitImgEl) return;
      const loading = dataLoading();
      const url = rabbitImageUrl();
      if (loading || !url) {
        rabbitImgEl.style.display = 'none';
        rabbitImgEl.removeAttribute('src');
        rabbitImgEl.alt = '';
        return;
      }
      rabbitImgEl.style.display = '';
      rabbitImgEl.src = url;
      rabbitImgEl.alt = rabbitAlt();
    });

    const refreshData = () => rabbitResource.refresh({ force: true });

    // ============================================
    // Query (cached data)
    // ============================================
    const queryClient = createQueryClient();
    const postId = signal(1);

    const postQuery = queryClient.query({
      key: () => key('post', postId()),
      fetch: async (signal) => {
        const res = await fetch(
          `https://jsonplaceholder.typicode.com/posts/${postId()}`,
          { signal }
        );
        if (!res.ok) throw new Error('Failed to fetch post');
        return res.json();
      },
      staleTime: 5000,
    });

    const postTitle = computed(() => {
      if (postQuery.loading()) return 'Loading...';
      if (postQuery.error()) return 'Error loading post';
      return postQuery.data()?.title ?? '';
    });

    const nextPost = () => {
      postId.update(id => (id >= 10 ? 1 : id + 1));
    };

    // ============================================
    // Mutation
    // ============================================
    const mutationResult = signal('Ready to save');
    const mutationCount = signal(0);

    const mutation = createMutation({
      mutate: async (signal, _input: void) => {
        await new Promise(r => setTimeout(r, 800));
        if (signal.aborted) throw new Error('Aborted');
        return { success: true };
      },
      onSuccess: () => {
        mutationCount.update(n => n + 1);
        mutationResult.set(`Saved! (${mutationCount()} times)`);
      },
      onError: (err) => {
        mutationResult.set(`Error: ${err.message}`);
      },
    });

    const mutationSaving = computed(() => mutation.loading());
    const mutationIdle = computed(() => !mutation.loading());

    const runMutation = () => mutation.run();

    // ============================================
    // Initialize DOM elements
    // ============================================
    queueMicrotask(() => {
      withScope(scope, () => {
        // Mount match fragment
        const matchDemo = document.getElementById('match-demo');
        if (matchDemo) {
          matchDemo.appendChild(matchFragment);
        }

        // Mount list
        const listContainer = document.getElementById('list-container');
        if (listContainer) {
          const listFragment = createList(
            () => items(),
            (item, index) => {
              const el = document.createElement('div');
              el.className = 'list-item';
              el.innerHTML = `
                <span>${item}</span>
                <span class="list-item-index">#${index + 1}</span>
              `;
              return el;
            },
            (item, index) => `${index}-${item}`
          );
          listContainer.appendChild(listFragment);
        }
      });
    });

    // ============================================
    // Return all bindings
    // ============================================
    return {
      // Theme (Context)
      themeName,
      themeIcon,
      toggleTheme,

      // Counter
      counter,
      doubled,
      counterStatus,
      increment,
      decrement,

      // Effect
      renderCount,

      // Batch
      batchMessage,
      runBatch,

      // Conditional
      isVisible,
      isHidden,
      toggleVisible,

      // List
      listCount,
      addItem,

      // Scopes
      scopeActive,
      scopeMessage,
      runScopeDemo,

      // Resource
      dataLoading,
      dataReady,
      dataError,
      rabbitImageUrl,
      rabbitAlt,
      dataErrorMsg,
      refreshData,

      // Query
      postId,
      postTitle,
      nextPost,

      // Mutation
      mutationSaving,
      mutationIdle,
      mutationResult,
      runMutation,
    };
  });
}
