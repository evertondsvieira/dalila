# Forms

DOM-first reactive form management with minimal meta-state, validation, and field arrays.

## Quick Start — Simple Form in 5 Lines

```ts
import { createForm } from 'dalila';

const form = createForm({
  validate: (data) => {
    if (!data.email?.includes('@')) return { email: 'Invalid email' };
  }
});
```

```html
<form d-form="form">
  <input d-field="email" />
  <span d-error="email"></span>
  <button>Submit</button>
</form>
```

That's it! No extra config needed for simple forms.

## When to Use What

| Need | Use |
|------|-----|
| Simple validation | Just `validate` function |
| Complex schemas | `schema` with Zod/Valibot/Yup |
| Field arrays | `d-array` directive |
| Custom parsing | `parse` function |

## Core Concepts

```
┌──────────────────────────────────────────────────────────────┐
│                     Form Lifecycle                           │
│                                                              │
│  DOM values → parseFormData → validate → handleSubmit        │
│                                                              │
│  Meta-state: errors, touched, dirty, submitting              │
│  Values live in the DOM, not in signals                      │
└──────────────────────────────────────────────────────────────┘
```

**Key ideas:**
1. **DOM-first values** — inputs keep their value; the form reads the DOM on demand
2. **Minimal meta-state** — only errors/touched/dirty/submitting live in memory
3. **Declarative bindings** — `d-form`, `d-field`, `d-error`, `d-array`
4. **Safe submits** — race-safe with `AbortController`

## API Reference

### createForm

```ts
import { createForm } from 'dalila';
// or: import { createForm } from 'dalila/form';

function createForm<T>(options?: FormOptions<T>): Form<T>
```

```ts
interface FormOptions<T> {
  defaultValues?:
    | Partial<T>
    | (() => Partial<T>)
    | (() => Promise<Partial<T>>);

  parse?: (formEl: HTMLFormElement, fd: FormData) => T;

  validate?: (data: T) =>
    | FieldErrors
    | { fieldErrors?: FieldErrors; formError?: string }
    | void;

  schema?: FormSchemaAdapter<T>;

  validateOn?: 'submit' | 'blur' | 'change';

  transformServerErrors?: (error: unknown) =>
    | { fieldErrors?: FieldErrors; formError?: string }
    | void;
}
```

```ts
type FieldErrors = Record<string, string>;
```

```ts
interface FormSchemaAdapter<T = unknown> {
  validate(data: unknown):
    | SchemaValidationResult<T>
    | Promise<SchemaValidationResult<T>>;
  validateField?(
    path: string,
    value: unknown,
    data: unknown
  ): SchemaValidationResult<T> | Promise<SchemaValidationResult<T>>;
  mapErrors?(error: unknown):
    | SchemaValidationIssue[]
    | { formError?: string };
}
```

```ts
interface Form<T> {
  handleSubmit(handler: (data: T, ctx: FormSubmitContext) => Promise<unknown> | unknown): (ev: SubmitEvent) => void;
  reset(nextDefaults?: Partial<T>): void;
  setError(path: string, message: string): void;
  setFormError(message: string): void;
  clearErrors(prefix?: string): void;
  error(path: string): string | null;
  formError(): string | null;
  touched(path: string): boolean;
  dirty(path: string): boolean;
  submitting(): boolean;
  submitCount(): number;
  focus(path?: string): void;
  fieldArray<TItem = unknown>(path: string): FieldArray<TItem>;
  watch(path: string, fn: (next: unknown, prev: unknown) => void): () => void;

  // Internal (used by runtime bindings)
  _registerField(path: string, element: HTMLElement): () => void;
  _getFormElement(): HTMLFormElement | null;
  _setFormElement(form: HTMLFormElement): void;
}
```

```ts
interface FormSubmitContext {
  signal: AbortSignal;
}
```

### `form.watch(path, fn)`

Observe a specific form path and run `fn(next, prev)` only when that path changes.
It supports nested paths and array paths (for example, `phones[0].number`), and returns an idempotent unsubscribe.

```ts
const stop = form.watch('user.email', (next, prev) => {
  console.log('email changed:', prev, '->', next);
});

// later
stop();
```

### parseFormData

```ts
import { parseFormData } from 'dalila/form';

function parseFormData<T = unknown>(form: HTMLFormElement, fd: FormData): T
```

Parses FormData into nested objects with dot/bracket notation and checkbox/select rules.

## Basic Usage

```ts
import { createForm } from 'dalila';

const userForm = createForm({
  defaultValues: { name: '', email: '' },
  validate: (data) => {
    const errors = {};
    if (!data.name) errors.name = 'Name is required';
    if (!data.email?.includes('@')) errors.email = 'Invalid email';
    return errors;
  }
});

async function handleSubmit(data, { signal }) {
  const res = await fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
    signal
  });
  if (!res.ok) throw new Error('Failed to save');
}
```

```html
<form d-form="userForm" d-on-submit="handleSubmit">
  <div>
    <label for="name">Name</label>
    <input d-field="name" id="name" />
    <span d-error="name"></span>
  </div>

  <div>
    <label for="email">Email</label>
    <input d-field="email" id="email" type="email" />
    <span d-error="email"></span>
  </div>

  <button type="submit">Save</button>
  <span d-form-error="userForm"></span>
</form>
```

## Directives

### d-form

Binds a `<form>` to a form instance and wires submit handling.

```html
<form d-form="userForm" d-on-submit="handleSubmit">
```

### d-field

Registers a field for touched/dirty tracking and accessibility wiring.

```html
<input d-field="email" />
```

**Behavior:**
- Sets `name` attribute if missing
- Adds `aria-invalid` and `aria-describedby` when field has error
- Tracks blur (touched) and change (dirty)

### d-error

Displays a field-level error.

```html
<span d-error="email"></span>
```

**Behavior:**
- Sets `role="alert"` and `aria-live="polite"`
- Updates ID for `aria-describedby`
- Hides when no error

### d-form-error

Displays a form-level error.

```html
<span d-form-error="userForm"></span>
```

### d-array

Binds a field array with stable keys and reorder support.

```html
<div d-array="phones">
  <div d-each="items">
    <input d-field="number" />
    <button d-on-click="$remove">Remove</button>
  </div>
  <button d-append="{ number: '' }">Add</button>
</div>
```

## Field Arrays

```ts
const form = createForm({
  defaultValues: {
    phones: [{ number: '', type: 'mobile' }]
  }
});

const phones = form.fieldArray('phones');
```

```ts
interface FieldArray<TItem = unknown> {
  fields(): { key: string; value?: TItem }[];
  append(value: TItem | TItem[]): void;
  remove(key: string): void;
  removeAt(index: number): void;
  insert(index: number, value: TItem): void;
  move(fromIndex: number, toIndex: number): void;
  swap(indexA: number, indexB: number): void;
  replace(values: TItem[]): void;
  update(key: string, value: TItem): void;
  updateAt(index: number, value: TItem): void;
  clear(): void;
  length(): number;
}
```

**Item context inside d-each:**
- `item` — current item value (signal)
- `key` — stable key for this item
- `$index`, `$count`, `$first`, `$last`, `$odd`, `$even` — reactive metadata
- `$remove()`, `$moveUp()`, `$moveDown()` — array operations bound to the item

## Validation

### Client-side validation

```ts
const form = createForm({
  validate: (data) => {
    const errors = {};
    if (!data.email?.includes('@')) errors.email = 'Invalid email';
    if (data.password && data.password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }
    if (data.password !== data.confirmPassword) {
      errors.confirmPassword = 'Passwords must match';
    }
    return errors;
  },
  validateOn: 'blur'
});
```

### Schema adapters (Zod, Valibot, Yup)

```ts
import { createForm, zodAdapter, valibotAdapter, yupAdapter } from 'dalila/form';

const zodForm = createForm({
  schema: zodAdapter(UserSchema)
});

const valibotForm = createForm({
  schema: valibotAdapter(UserSchema)
});

const yupForm = createForm({
  schema: yupAdapter(UserSchema)
});
```

Pass Valibot runtime explicitly:

```ts
import * as v from 'valibot';
const form = createForm({ schema: valibotAdapter(UserSchema, v) });
```

`schema` and `validate` can be used together. Validation pipeline supports sync/async adapters.
When `validateOn` is `blur` or `change`, `validateField()` is used when available.

### Server-side errors

```ts
const form = createForm({
  transformServerErrors: (err) => {
    if (err.response?.status === 422) {
      return {
        fieldErrors: {
          email: 'Email already taken',
          phone: 'Invalid phone format'
        },
        formError: 'Please fix the errors above'
      };
    }
    return { formError: 'Server error occurred' };
  }
});
```

## parseFormData Details

### Dot and bracket paths

```
"user.name"        → { user: { name: "..." } }
"phones[0].number" → { phones: [ { number: "..." } ] }
```

### Types

- `input[type=number]` → number (when parseable)
- `input[type=file]` → File
- `select[multiple]` → array of values

## Checkbox Contract

### Single checkbox → boolean

```html
<input type="checkbox" name="agree" />
```

```ts
// Unchecked: { agree: false }
// Checked: { agree: true }
```

### Multiple checkboxes → array

```html
<input type="checkbox" name="colors" value="red" />
<input type="checkbox" name="colors" value="blue" />
```

```ts
// None checked: { colors: [] }
// One checked:  { colors: ["red"] }
```

### Select multiple

```html
<select name="tags" multiple>
  <option value="js">JavaScript</option>
  <option value="ts">TypeScript</option>
</select>
```

```ts
// No selection: { tags: [] }
// Selection:    { tags: ["js", "ts"] }
```

## Examples

See `examples/forms` for complete demos:
- Basic form with validation
- Nested objects and arrays
- Dynamic field arrays with reordering
- File uploads
- Multi-step forms
- Async validation

---

**See also:**
- [Bind](./runtime/bind.md) — Template binding runtime
- [Signals](./core/signals.md) — Reactive primitives
- [Scope](./core/scope.md) — Lifecycle and cleanup
