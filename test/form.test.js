/**
 * Tests for Dalila Forms
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createForm, parseFormData } from '../dist/form/index.js';
import { createScope, withScope } from '../dist/core/scope.js';

// Simple mock function helper
function mockFn(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };

  Object.defineProperty(fn, 'calls', { get: () => calls });
  Object.defineProperty(fn, 'callCount', { get: () => calls.length });
  return fn;
}

describe('parseFormData', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    global.document = document;
    global.FormData = dom.window.FormData;
  });

  it('should parse simple fields', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="email" value="test@example.com" />
      <input name="password" value="secret123" />
    `;

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      email: 'test@example.com',
      password: 'secret123',
    });
  });

  it('should parse nested objects', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="user.name" value="John" />
      <input name="user.email" value="john@example.com" />
    `;

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      user: {
        name: 'John',
        email: 'john@example.com',
      },
    });
  });

  it('should parse arrays', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="phones[0].number" value="555-1234" />
      <input name="phones[0].type" value="mobile" />
      <input name="phones[1].number" value="555-5678" />
      <input name="phones[1].type" value="home" />
    `;

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      phones: [
        { number: '555-1234', type: 'mobile' },
        { number: '555-5678', type: 'home' },
      ],
    });
  });

  it('should handle single checkbox as boolean', () => {
    const form = document.createElement('form');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'agree';
    checkbox.checked = true;
    form.appendChild(checkbox);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      agree: true,
    });
  });

  it('should handle unchecked checkbox as false', () => {
    const form = document.createElement('form');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'agree';
    checkbox.checked = false;
    form.appendChild(checkbox);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      agree: false,
    });
  });

  it('should handle multiple checkboxes as array', () => {
    const form = document.createElement('form');

    const cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.name = 'colors';
    cb1.value = 'red';
    cb1.checked = true;
    form.appendChild(cb1);

    const cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.name = 'colors';
    cb2.value = 'blue';
    cb2.checked = true;
    form.appendChild(cb2);

    const cb3 = document.createElement('input');
    cb3.type = 'checkbox';
    cb3.name = 'colors';
    cb3.value = 'green';
    cb3.checked = false;
    form.appendChild(cb3);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      colors: ['red', 'blue'],
    });
  });

  // ============================================================================
  // Additional Checkbox Contract Tests
  // ============================================================================

  it('should handle single checkbox with value attribute as boolean', () => {
    const form = document.createElement('form');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'newsletter';
    checkbox.value = 'yes';
    checkbox.checked = true;
    form.appendChild(checkbox);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    // Single checkbox always returns boolean, not the value attribute
    assert.deepStrictEqual(result, {
      newsletter: true,
    });
  });

  it('should handle multiple checkboxes with all unchecked as empty array', () => {
    const form = document.createElement('form');

    const cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.name = 'colors';
    cb1.value = 'red';
    cb1.checked = false;
    form.appendChild(cb1);

    const cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.name = 'colors';
    cb2.value = 'blue';
    cb2.checked = false;
    form.appendChild(cb2);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      colors: [],
    });
  });

  it('should handle multiple checkboxes with one checked as single-item array', () => {
    const form = document.createElement('form');

    const cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.name = 'colors';
    cb1.value = 'red';
    cb1.checked = true;
    form.appendChild(cb1);

    const cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.name = 'colors';
    cb2.value = 'blue';
    cb2.checked = false;
    form.appendChild(cb2);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    // Multiple checkboxes always return array, even with just one checked
    assert.deepStrictEqual(result, {
      colors: ['red'],
    });
  });

  it('should handle multiple checkboxes with all checked', () => {
    const form = document.createElement('form');

    const cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.name = 'features';
    cb1.value = 'feature1';
    cb1.checked = true;
    form.appendChild(cb1);

    const cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.name = 'features';
    cb2.value = 'feature2';
    cb2.checked = true;
    form.appendChild(cb2);

    const cb3 = document.createElement('input');
    cb3.type = 'checkbox';
    cb3.name = 'features';
    cb3.value = 'feature3';
    cb3.checked = true;
    form.appendChild(cb3);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      features: ['feature1', 'feature2', 'feature3'],
    });
  });

  it('should handle mixed form with checkboxes and other inputs', () => {
    const form = document.createElement('form');

    // Regular input
    const emailInput = document.createElement('input');
    emailInput.type = 'text';
    emailInput.name = 'email';
    emailInput.value = 'test@example.com';
    form.appendChild(emailInput);

    // Single checkbox
    const agreeCheckbox = document.createElement('input');
    agreeCheckbox.type = 'checkbox';
    agreeCheckbox.name = 'agree';
    agreeCheckbox.checked = false;
    form.appendChild(agreeCheckbox);

    // Multiple checkboxes
    const cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.name = 'interests';
    cb1.value = 'sports';
    cb1.checked = true;
    form.appendChild(cb1);

    const cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.name = 'interests';
    cb2.value = 'music';
    cb2.checked = false;
    form.appendChild(cb2);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      email: 'test@example.com',
      agree: false,
      interests: ['sports'],
    });
  });

  // ============================================================================
  // P2 FIX Tests: Select Multiple
  // ============================================================================

  it('should handle select multiple with selections', () => {
    const form = document.createElement('form');

    const select = document.createElement('select');
    select.name = 'tags';
    select.multiple = true;

    const opt1 = document.createElement('option');
    opt1.value = 'javascript';
    opt1.selected = true;
    select.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = 'typescript';
    opt2.selected = true;
    select.appendChild(opt2);

    const opt3 = document.createElement('option');
    opt3.value = 'rust';
    opt3.selected = false;
    select.appendChild(opt3);

    form.appendChild(select);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      tags: ['javascript', 'typescript'],
    });
  });

  it('should handle select multiple with no selections', () => {
    const form = document.createElement('form');

    const select = document.createElement('select');
    select.name = 'tags';
    select.multiple = true;

    const opt1 = document.createElement('option');
    opt1.value = 'javascript';
    opt1.selected = false;
    select.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = 'typescript';
    opt2.selected = false;
    select.appendChild(opt2);

    form.appendChild(select);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      tags: [],
    });
  });

  it('should exclude disabled checkboxes from parsed data', () => {
    const form = document.createElement('form');

    // Enabled checkbox (unchecked) → should appear as false
    const enabledCb = document.createElement('input');
    enabledCb.type = 'checkbox';
    enabledCb.name = 'agree';
    enabledCb.checked = false;
    form.appendChild(enabledCb);

    // Disabled checkbox → should NOT appear in result
    const disabledCb = document.createElement('input');
    disabledCb.type = 'checkbox';
    disabledCb.name = 'hidden';
    disabledCb.disabled = true;
    disabledCb.checked = false;
    form.appendChild(disabledCb);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      agree: false,
    });
    // 'hidden' should not be in the result at all
    assert.strictEqual('hidden' in result, false);
  });

  it('should exclude disabled multiple checkboxes from parsed data', () => {
    const form = document.createElement('form');

    // Enabled checkboxes
    const cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.name = 'colors';
    cb1.value = 'red';
    cb1.checked = true;
    form.appendChild(cb1);

    const cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.name = 'colors';
    cb2.value = 'blue';
    cb2.checked = false;
    form.appendChild(cb2);

    // Disabled checkbox group → should NOT appear
    const dcb1 = document.createElement('input');
    dcb1.type = 'checkbox';
    dcb1.name = 'features';
    dcb1.value = 'a';
    dcb1.disabled = true;
    form.appendChild(dcb1);

    const dcb2 = document.createElement('input');
    dcb2.type = 'checkbox';
    dcb2.name = 'features';
    dcb2.value = 'b';
    dcb2.disabled = true;
    form.appendChild(dcb2);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      colors: ['red'],
    });
    assert.strictEqual('features' in result, false);
  });

  it('should exclude disabled select[multiple] from parsed data', () => {
    const form = document.createElement('form');

    // Enabled select multiple
    const select = document.createElement('select');
    select.name = 'tags';
    select.multiple = true;
    const opt1 = document.createElement('option');
    opt1.value = 'js';
    opt1.selected = true;
    select.appendChild(opt1);
    form.appendChild(select);

    // Disabled select multiple → should NOT appear
    const disabledSelect = document.createElement('select');
    disabledSelect.name = 'hidden_tags';
    disabledSelect.multiple = true;
    disabledSelect.disabled = true;
    const opt2 = document.createElement('option');
    opt2.value = 'rust';
    opt2.selected = false;
    disabledSelect.appendChild(opt2);
    form.appendChild(disabledSelect);

    const fd = new FormData(form);
    const result = parseFormData(form, fd);

    assert.deepStrictEqual(result, {
      tags: ['js'],
    });
    assert.strictEqual('hidden_tags' in result, false);
  });
});

describe('createForm', () => {
  let dom;
  let document;
  let scope;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    global.document = document;
    global.FormData = dom.window.FormData;
    global.HTMLFormElement = dom.window.HTMLFormElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;

    scope = createScope();
  });

  it('should create a form instance', () => {
    const form = withScope(scope, () => createForm());

    assert.ok(form);
    assert.strictEqual(typeof form.handleSubmit, 'function');
    assert.strictEqual(typeof form.reset, 'function');
    assert.strictEqual(typeof form.setError, 'function');
  });

  it('should validate on submit', async () => {
    const form = withScope(scope, () =>
      createForm({
        validate: (data) => {
          const errors = {};
          if (!data.email) {
            errors.email = 'Email is required';
          }
          return errors;
        },
      })
    );

    const formElement = document.createElement('form');
    formElement.innerHTML = '<input name="email" value="" />';
    form._setFormElement(formElement);

    const handler = mockFn();
    const submitHandler = form.handleSubmit(handler);

    const event = new dom.window.Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: formElement });

    await submitHandler(event);

    // Handler should not be called due to validation error
    assert.strictEqual(handler.callCount, 0);
    assert.strictEqual(form.error('email'), 'Email is required');
  });

  it('should call handler on valid submit', async () => {
    const form = withScope(scope, () =>
      createForm({
        validate: (data) => {
          const errors = {};
          if (!data.email) {
            errors.email = 'Email is required';
          }
          return errors;
        },
      })
    );

    const formElement = document.createElement('form');
    formElement.innerHTML = '<input name="email" value="test@example.com" />';
    form._setFormElement(formElement);

    const handler = mockFn((data) => {
      assert.deepStrictEqual(data, { email: 'test@example.com' });
    });
    const submitHandler = form.handleSubmit(handler);

    const event = new dom.window.Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: formElement });

    await submitHandler(event);

    assert.strictEqual(handler.callCount, 1);
    assert.strictEqual(form.error('email'), null);
  });

  it('should handle async submit with abort', async () => {
    const form = withScope(scope, () => createForm());

    const formElement = document.createElement('form');
    formElement.innerHTML = '<input name="email" value="test@example.com" />';
    form._setFormElement(formElement);

    let firstCallAborted = false;
    const handler = mockFn(async (data, { signal }) => {
      // Simulate slow async work
      await new Promise(resolve => setTimeout(resolve, 100));
      if (signal.aborted) {
        firstCallAborted = true;
      }
    });

    const submitHandler = form.handleSubmit(handler);

    // First submit
    const event1 = new dom.window.Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event1, 'target', { value: formElement });

    const promise1 = submitHandler(event1);

    // Immediately submit again (should abort first)
    const event2 = new dom.window.Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event2, 'target', { value: formElement });

    const promise2 = submitHandler(event2);

    await Promise.all([promise1, promise2]);

    // First call should have been aborted
    assert.strictEqual(firstCallAborted, true);
    assert.strictEqual(handler.callCount, 2);
  });

  it('should track touched state', () => {
    const form = withScope(scope, () => createForm());

    assert.strictEqual(form.touched('email'), false);

    const input = document.createElement('input');
    input.name = 'email';
    form._registerField('email', input);

    // Simulate blur
    input.dispatchEvent(new dom.window.Event('blur'));

    assert.strictEqual(form.touched('email'), true);
  });

  it('should track dirty state', async () => {
    const form = withScope(scope, () =>
      createForm({
        defaultValues: {
          email: 'initial@example.com',
        },
      })
    );

    // Wait for defaults to initialize
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(form.dirty('email'), false);

    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'email';
    input.value = 'initial@example.com';
    form._registerField('email', input);

    // Change value
    input.value = 'changed@example.com';
    input.dispatchEvent(new dom.window.Event('change'));

    assert.strictEqual(form.dirty('email'), true);
  });

  it('should reset form state', () => {
    const form = withScope(scope, () => createForm());

    form.setError('email', 'Invalid email');
    form.setFormError('Form error');

    assert.strictEqual(form.error('email'), 'Invalid email');
    assert.strictEqual(form.formError(), 'Form error');

    form.reset();

    assert.strictEqual(form.error('email'), null);
    assert.strictEqual(form.formError(), null);
  });

  it('should watch a specific path and allow idempotent unsubscribe', () => {
    const form = withScope(scope, () => createForm());
    const formElement = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'email';
    input.setAttribute('d-field', '');
    input.value = 'a@example.com';
    formElement.appendChild(input);

    form._setFormElement(formElement);
    form._registerField('email', input);

    const changes = [];
    const stop = form.watch('email', (next, prev) => {
      changes.push({ next, prev });
    });

    input.value = 'b@example.com';
    input.dispatchEvent(new dom.window.Event('change'));

    assert.deepStrictEqual(changes, [
      { next: 'b@example.com', prev: 'a@example.com' },
    ]);

    stop();
    stop();
    input.value = 'c@example.com';
    input.dispatchEvent(new dom.window.Event('change'));
    assert.strictEqual(changes.length, 1);
  });

  it('should use options.parse for watch snapshots', () => {
    const form = withScope(scope, () =>
      createForm({
        parse: (formEl, fd) => {
          const raw = parseFormData(formEl, fd);
          return {
            email: String(raw.email ?? '').trim().toLowerCase(),
          };
        },
      })
    );

    const formElement = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'email';
    input.setAttribute('d-field', '');
    input.value = '  A@EXAMPLE.COM  ';
    formElement.appendChild(input);
    form._setFormElement(formElement);
    form._registerField('email', input);

    const calls = [];
    form.watch('email', (next, prev) => {
      calls.push({ next, prev });
    });

    input.value = '  B@EXAMPLE.COM  ';
    input.dispatchEvent(new dom.window.Event('change'));

    assert.deepStrictEqual(calls, [
      { next: 'b@example.com', prev: 'a@example.com' },
    ]);
  });

  it('should watch array item paths across fieldArray reorder operations', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');
    array.append([{ number: '111' }, { number: '222' }]);

    const runs = [];
    form.watch('phones[0].number', (next, prev) => {
      runs.push({ next, prev });
    });

    array.move(1, 0);
    assert.deepStrictEqual(runs, [{ next: '222', prev: '111' }]);

    array.move(0, 1);
    assert.deepStrictEqual(runs, [
      { next: '222', prev: '111' },
      { next: '111', prev: '222' },
    ]);
  });

  it('should notify watchers after reset updates values', () => {
    const form = withScope(scope, () => createForm());
    const formElement = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'email';
    input.setAttribute('d-field', '');
    input.value = 'before@example.com';
    formElement.appendChild(input);
    form._setFormElement(formElement);
    form._registerField('email', input);

    const calls = [];
    form.watch('email', (next, prev) => {
      calls.push({ next, prev });
    });

    form.reset({ email: 'after@example.com' });

    assert.deepStrictEqual(calls, [
      { next: 'after@example.com', prev: 'before@example.com' },
    ]);
  });

  it('should prefer live DOM values over fieldArray cache when watching array paths', () => {
    const form = withScope(scope, () => createForm());
    const formElement = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'phones[0].number';
    input.setAttribute('d-field', '');
    input.setAttribute('data-field-path', 'phones[0].number');
    input.value = '111';
    formElement.appendChild(input);
    form._setFormElement(formElement);
    form._registerField('phones[0].number', input);

    const array = form.fieldArray('phones');
    array.append({ number: '111' });

    const calls = [];
    form.watch('phones[0].number', (next, prev) => {
      calls.push({ next, prev });
    });

    input.value = '999';
    input.dispatchEvent(new dom.window.Event('change'));

    assert.deepStrictEqual(calls, [
      { next: '999', prev: '111' },
    ]);
  });

  it('should notify watchers even before async defaults initialization finishes', () => {
    const form = withScope(scope, () =>
      createForm({
        defaultValues: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { email: 'seed@example.com' };
        },
      })
    );

    const formElement = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'email';
    input.setAttribute('d-field', '');
    input.value = 'early@example.com';
    formElement.appendChild(input);
    form._setFormElement(formElement);
    form._registerField('email', input);

    const calls = [];
    form.watch('email', (next, prev) => {
      calls.push({ next, prev });
    });

    input.value = 'typed-before-defaults@example.com';
    input.dispatchEvent(new dom.window.Event('input'));

    assert.deepStrictEqual(calls, [
      { next: 'typed-before-defaults@example.com', prev: 'early@example.com' },
    ]);
  });

  it('should notify array-path watchers on fieldArray move before DOM reorder patch', () => {
    const form = withScope(scope, () => createForm());
    const formElement = document.createElement('form');
    const input0 = document.createElement('input');
    input0.name = 'phones[0].number';
    input0.setAttribute('d-field', '');
    input0.setAttribute('data-field-path', 'phones[0].number');
    input0.value = '111';
    formElement.appendChild(input0);

    const input1 = document.createElement('input');
    input1.name = 'phones[1].number';
    input1.setAttribute('d-field', '');
    input1.setAttribute('data-field-path', 'phones[1].number');
    input1.value = '222';
    formElement.appendChild(input1);

    form._setFormElement(formElement);
    form._registerField('phones[0].number', input0);
    form._registerField('phones[1].number', input1);

    const array = form.fieldArray('phones');
    array.append([{ number: '111' }, { number: '222' }]);

    const calls = [];
    form.watch('phones[0].number', (next, prev) => {
      calls.push({ next, prev });
    });

    // Simulate mutation notification happening before DOM paths/values are patched.
    array.move(1, 0);

    assert.deepStrictEqual(calls, [
      { next: '222', prev: '111' },
    ]);
  });

  it('should notify pre-registered watchers when fieldArray hydrates from sync defaults', async () => {
    const form = withScope(scope, () =>
      createForm({
        defaultValues: {
          phones: [{ number: '555-1234' }],
        },
      })
    );

    // Wait for defaultValues initialization task.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = [];
    form.watch('phones[0].number', (next, prev) => {
      calls.push({ next, prev });
    });

    // Initial hydration should emit undefined -> default transition.
    form.fieldArray('phones');

    assert.deepStrictEqual(calls, [
      { next: '555-1234', prev: undefined },
    ]);
  });

  it('should avoid stale duplicate watch callbacks for removed array indices after reset', () => {
    const form = withScope(scope, () => createForm());
    const formElement = document.createElement('form');

    const input0 = document.createElement('input');
    input0.name = 'phones[0].number';
    input0.setAttribute('d-field', '');
    input0.setAttribute('data-field-path', 'phones[0].number');
    input0.value = '111';
    formElement.appendChild(input0);

    const input1 = document.createElement('input');
    input1.name = 'phones[1].number';
    input1.setAttribute('d-field', '');
    input1.setAttribute('data-field-path', 'phones[1].number');
    input1.value = 'stale-dom';
    formElement.appendChild(input1);

    form._setFormElement(formElement);
    form._registerField('phones[0].number', input0);
    form._registerField('phones[1].number', input1);

    const array = form.fieldArray('phones');
    array.append([{ number: '111' }, { number: '222' }]);

    const calls = [];
    form.watch('phones[1].number', (next, prev) => {
      calls.push({ next, prev });
    });

    // Shrink array to one item; second row remains stale in DOM until view patch.
    form.reset({
      phones: [{ number: '111' }],
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].next, undefined);
    assert.strictEqual(calls[0].prev, 'stale-dom');
  });
});

describe('FieldArray Meta-State Remapping', () => {
  let dom;
  let document;
  let scope;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    global.document = document;
    global.FormData = dom.window.FormData;
    global.HTMLFormElement = dom.window.HTMLFormElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;
    scope = createScope();
  });

  it('should remap errors when moving items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });
    array.append({ number: '333' });

    // Set error on first item
    form.setError('phones[0].number', 'Invalid number 0');
    form.setError('phones[2].number', 'Invalid number 2');

    assert.strictEqual(form.error('phones[0].number'), 'Invalid number 0');
    assert.strictEqual(form.error('phones[2].number'), 'Invalid number 2');

    // Move first item to end (index 0 -> 2)
    array.move(0, 2);

    // Errors should follow the items
    // Old index 0 -> new index 2
    // Old index 1 -> new index 0
    // Old index 2 -> new index 1
    assert.strictEqual(form.error('phones[2].number'), 'Invalid number 0');
    assert.strictEqual(form.error('phones[1].number'), 'Invalid number 2');
  });

  it('should remap errors when swapping items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });

    form.setError('phones[0].number', 'Error on first');
    form.setError('phones[1].number', 'Error on second');

    array.swap(0, 1);

    // Errors should be swapped
    assert.strictEqual(form.error('phones[1].number'), 'Error on first');
    assert.strictEqual(form.error('phones[0].number'), 'Error on second');
  });

  it('should remap errors when removing items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });
    array.append({ number: '333' });

    form.setError('phones[2].number', 'Error on third');

    // Remove first item - indices shift down
    const fields = array.fields();
    array.remove(fields[0].key);

    // Error on old index 2 should now be at index 1
    assert.strictEqual(form.error('phones[1].number'), 'Error on third');
  });

  it('should remap errors when inserting items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '333' });

    form.setError('phones[1].number', 'Error on second');

    // Insert at index 1 - indices shift up
    array.insert(1, { number: '222' });

    // Error on old index 1 should now be at index 2
    assert.strictEqual(form.error('phones[2].number'), 'Error on second');
  });
});

describe('FieldArray', () => {
  let dom;
  let document;
  let scope;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    global.document = document;
    scope = createScope();
  });

  it('should create a field array', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    assert.ok(array);
    assert.strictEqual(typeof array.append, 'function');
    assert.strictEqual(typeof array.remove, 'function');
  });

  it('should append items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    assert.strictEqual(array.fields().length, 0);

    array.append({ number: '555-1234' });
    assert.strictEqual(array.fields().length, 1);

    array.append({ number: '555-5678' });
    assert.strictEqual(array.fields().length, 2);
  });

  it('should remove items by key', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '555-1234' });
    array.append({ number: '555-5678' });

    const fields = array.fields();
    assert.strictEqual(fields.length, 2);

    const firstKey = fields[0].key;
    array.remove(firstKey);

    assert.strictEqual(array.fields().length, 1);
    assert.deepStrictEqual(array.fields()[0].value, { number: '555-5678' });
  });

  it('should move items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });
    array.append({ number: '333' });

    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '111' },
      { number: '222' },
      { number: '333' },
    ]);

    array.move(0, 2);

    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '222' },
      { number: '333' },
      { number: '111' },
    ]);
  });

  it('should swap items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });
    array.append({ number: '333' });

    array.swap(0, 2);

    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '333' },
      { number: '222' },
      { number: '111' },
    ]);
  });

  it('should insert items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '333' });

    array.insert(1, { number: '222' });

    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '111' },
      { number: '222' },
      { number: '333' },
    ]);
  });

  it('should maintain stable keys after reorder', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });

    const keys1 = array.fields().map(f => f.key);

    array.move(0, 1);

    const keys2 = array.fields().map(f => f.key);

    // Keys should remain the same, just in different order
    assert.strictEqual(keys2[0], keys1[1]);
    assert.strictEqual(keys2[1], keys1[0]);
  });

  it('should replace entire array', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });

    array.replace([
      { number: '333' },
      { number: '444' },
      { number: '555' },
    ]);

    assert.strictEqual(array.fields().length, 3);
    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '333' },
      { number: '444' },
      { number: '555' },
    ]);
  });

  it('should clear all items', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });

    assert.strictEqual(array.fields().length, 2);

    array.clear();

    assert.strictEqual(array.fields().length, 0);
  });

  it('should ignore out-of-bounds operations', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });

    // move with invalid indices should be no-op
    array.move(-1, 0);
    array.move(0, 5);
    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '111' },
      { number: '222' },
    ]);

    // swap with invalid indices should be no-op
    array.swap(-1, 0);
    array.swap(0, 10);
    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '111' },
      { number: '222' },
    ]);

    // removeAt with invalid index should be no-op
    array.removeAt(-1);
    array.removeAt(5);
    assert.strictEqual(array.fields().length, 2);

    // insert with invalid index should be no-op
    array.insert(-1, { number: '333' });
    array.insert(10, { number: '333' });
    assert.strictEqual(array.fields().length, 2);

    // updateAt with invalid index should be no-op
    array.updateAt(-1, { number: '999' });
    array.updateAt(5, { number: '999' });
    assert.deepStrictEqual(array.fields().map(f => f.value), [
      { number: '111' },
      { number: '222' },
    ]);
  });
});

describe('Form reset with field arrays', () => {
  let dom;
  let document;
  let scope;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    global.document = document;
    global.FormData = dom.window.FormData;
    global.HTMLFormElement = dom.window.HTMLFormElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;
    scope = createScope();
  });

  it('should reset field arrays to default values', async () => {
    const form = withScope(scope, () =>
      createForm({
        defaultValues: {
          phones: [
            { number: '555-1234', type: 'mobile' },
          ],
        },
      })
    );

    // Wait for defaults to initialize
    await new Promise(resolve => setTimeout(resolve, 0));

    const array = form.fieldArray('phones');

    // Modify the array
    array.append({ number: '555-5678', type: 'home' });
    array.append({ number: '555-9999', type: 'work' });
    assert.strictEqual(array.fields().length, 3);

    // Reset should restore to default (1 item)
    form.reset();
    assert.strictEqual(array.fields().length, 1);
    assert.deepStrictEqual(array.fields()[0].value, { number: '555-1234', type: 'mobile' });
  });

  it('should clear field arrays when no defaults exist', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    array.append({ number: '222' });
    assert.strictEqual(array.fields().length, 2);

    form.reset();
    assert.strictEqual(array.fields().length, 0);
  });

  it('should reset field arrays to new defaults', () => {
    const form = withScope(scope, () => createForm());
    const array = form.fieldArray('phones');

    array.append({ number: '111' });
    assert.strictEqual(array.fields().length, 1);

    // Reset with new defaults
    form.reset({
      phones: [
        { number: 'AAA' },
        { number: 'BBB' },
      ],
    });

    assert.strictEqual(array.fields().length, 2);
    assert.deepStrictEqual(array.fields()[0].value, { number: 'AAA' });
    assert.deepStrictEqual(array.fields()[1].value, { number: 'BBB' });
  });
});

describe('Async defaultValues with field arrays', () => {
  let dom;
  let document;
  let scope;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    global.document = document;
    global.FormData = dom.window.FormData;
    global.HTMLFormElement = dom.window.HTMLFormElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;
    scope = createScope();
  });

  it('should hydrate pre-created field arrays when async defaults resolve', async () => {
    const form = withScope(scope, () =>
      createForm({
        defaultValues: async () => {
          // Simulate async fetch
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            phones: [
              { number: '555-1234', type: 'mobile' },
              { number: '555-5678', type: 'home' },
            ],
          };
        },
      })
    );

    // Create field array BEFORE async defaults resolve
    const array = form.fieldArray('phones');
    assert.strictEqual(array.fields().length, 0);

    // Wait for async defaults to resolve + hydration
    await new Promise(resolve => setTimeout(resolve, 50));

    // Array should now be populated from defaults
    assert.strictEqual(array.fields().length, 2);
    assert.deepStrictEqual(array.fields()[0].value, { number: '555-1234', type: 'mobile' });
    assert.deepStrictEqual(array.fields()[1].value, { number: '555-5678', type: 'home' });
  });

  it('should not overwrite manually populated field arrays on async defaults resolve', async () => {
    const form = withScope(scope, () =>
      createForm({
        defaultValues: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            phones: [
              { number: 'default-1' },
            ],
          };
        },
      })
    );

    // Create and manually populate field array BEFORE async defaults resolve
    const array = form.fieldArray('phones');
    array.append({ number: 'user-added' });
    assert.strictEqual(array.fields().length, 1);

    // Wait for async defaults to resolve
    await new Promise(resolve => setTimeout(resolve, 50));

    // Array should NOT be overwritten because it already has items
    assert.strictEqual(array.fields().length, 1);
    assert.deepStrictEqual(array.fields()[0].value, { number: 'user-added' });
  });
});
