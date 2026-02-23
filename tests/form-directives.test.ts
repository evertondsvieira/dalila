/**
 * Form directive integration tests
 *
 * Tests the full wiring of form directives through bind():
 *   1  d-form — binds form instance to <form> element
 *   2  d-field — registers fields, sets name, wires aria attributes
 *   3  d-error — displays field-level error messages
 *   4  d-form-error — displays form-level error messages
 *   5  d-array — renders field arrays with stable keys
 *   6  d-form-error explicit binding — uses attribute value directly
 *   7  d-form auto-wraps submit handler
 *   8  d-field + d-error react to error changes
 *   9  d-array with append/remove operations
 *  10  d-array reorder preserves DOM input values
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { signal } from '../dist/core/signal.js';
import { createScope, withScope } from '../dist/core/scope.js';
import { bind } from '../dist/runtime/bind.js';
import { createForm } from '../dist/form/index.js';

// ─── shared helpers ─────────────────────────────────────────────────────────

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Spin up a fresh JSDOM for the duration of one test.
 * Sets necessary globals and tears them down afterwards.
 */
async function withDom(fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).NodeFilter = dom.window.NodeFilter;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLFormElement = dom.window.HTMLFormElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
  (globalThis as any).DocumentFragment = dom.window.DocumentFragment;
  (globalThis as any).Comment = dom.window.Comment;
  (globalThis as any).FormData = dom.window.FormData;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).CSS = dom.window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };

  try {
    await fn(dom.window.document, dom);
  } finally {
    await tick(20);
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).NodeFilter;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLFormElement;
    delete (globalThis as any).HTMLInputElement;
    delete (globalThis as any).HTMLSelectElement;
    delete (globalThis as any).DocumentFragment;
    delete (globalThis as any).Comment;
    delete (globalThis as any).FormData;
    delete (globalThis as any).Event;
    delete (globalThis as any).CSS;
  }
}

/** Parse HTML, append to body, return root element. */
function el(doc, html) {
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html.trim();
  const root = wrapper.firstElementChild;
  doc.body.appendChild(root);
  return root;
}

// ─── 1  d-form binds form instance ─────────────────────────────────────────

test('d-form registers form element with form instance', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" type="text" />
        <button type="submit">Submit</button>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    assert.ok(myForm._getFormElement(), 'form element should be registered');
    assert.equal(myForm._getFormElement(), formEl, 'should be the correct form element');
  });
});

// ─── 2  d-field sets name and registers field ───────────────────────────────

test('d-field sets name attribute when not present', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" type="text" />
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    const input = formEl.querySelector('input');
    assert.equal(input.getAttribute('name'), 'email', 'name attribute should be set from d-field');
  });
});

test('d-field does not overwrite existing name attribute', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" name="custom_email" type="text" />
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    const input = formEl.querySelector('input');
    assert.equal(input.getAttribute('name'), 'custom_email', 'existing name should be preserved');
  });
});

// ─── 3  d-error displays field errors ───────────────────────────────────────

test('d-error shows field error message', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" type="text" />
        <span d-error="email"></span>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    const errorSpan = formEl.querySelector('[d-error]');

    // Initially hidden
    assert.equal(errorSpan.style.display, 'none', 'should be hidden when no error');
    assert.equal(errorSpan.textContent, '', 'should have no text when no error');

    // Set an error
    myForm.setError('email', 'Email is required');
    await tick(10);

    assert.equal(errorSpan.textContent, 'Email is required', 'should show error message');
    assert.equal(errorSpan.style.display, '', 'should be visible when error');

    // Clear error
    myForm.clearErrors();
    await tick(10);

    assert.equal(errorSpan.textContent, '', 'should clear error text');
    assert.equal(errorSpan.style.display, 'none', 'should hide when error cleared');
  });
});

test('d-error has accessibility attributes', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" type="text" />
        <span d-error="email"></span>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    const errorSpan = formEl.querySelector('[d-error]');
    assert.equal(errorSpan.getAttribute('role'), 'alert');
    assert.equal(errorSpan.getAttribute('aria-live'), 'polite');
    assert.ok(errorSpan.id, 'should have an id for aria-describedby');
  });
});

// ─── 4  d-form-error displays form-level errors ────────────────────────────

test('d-form-error shows form-level error message', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" type="text" />
        <span d-form-error="myForm"></span>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    const formError = formEl.querySelector('[d-form-error]');

    // Initially hidden
    assert.equal(formError.style.display, 'none');
    assert.equal(formError.textContent, '');

    // Set form error
    myForm.setFormError('Server error occurred');
    await tick(10);

    assert.equal(formError.textContent, 'Server error occurred');
    assert.equal(formError.style.display, '');

    // Clear
    myForm.clearErrors();
    await tick(10);

    assert.equal(formError.textContent, '');
    assert.equal(formError.style.display, 'none');
  });
});

// ─── 5  d-field + d-error react to aria-invalid ────────────────────────────

test('d-field sets aria-invalid when field has error', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <input d-field="email" type="text" />
        <span d-error="email"></span>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(10);

    const input = formEl.querySelector('input');

    // No error → no aria-invalid
    assert.equal(input.getAttribute('aria-invalid'), null);

    // Set error
    myForm.setError('email', 'Invalid email');
    await tick(10);

    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.ok(input.getAttribute('aria-describedby'), 'should have aria-describedby');

    // Clear error
    myForm.clearErrors();
    await tick(10);

    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(input.getAttribute('aria-describedby'), null);
  });
});

// ─── 6  d-form-error with explicit binding name ────────────────────────────

test('d-form-error works with explicit form binding outside form', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    // Form error element is OUTSIDE the form, using explicit binding
    const container = el(doc, `
      <div>
        <form d-form="myForm">
          <input d-field="email" type="text" />
        </form>
        <span d-form-error="myForm"></span>
      </div>
    `);

    bind(container, { myForm });
    await tick(10);

    const formError = container.querySelector('[d-form-error]');

    myForm.setFormError('Something went wrong');
    await tick(10);

    assert.equal(formError.textContent, 'Something went wrong');
  });
});

// ─── 7  d-form auto-wraps submit handler ────────────────────────────────────

test('d-form auto-wraps submit handler through handleSubmit', async () => {
  await withDom(async (doc, dom) => {
    const scope = createScope();
    const myForm = withScope(scope, () =>
      createForm({
        validate: (data: any) => {
          const errors: Record<string, string> = {};
          if (!data.email) errors.email = 'Required';
          return errors;
        },
      })
    );

    let submittedData = null;
    function onSubmit(data) {
      submittedData = data;
    }

    const formEl = el(doc, `
      <form d-form="myForm" d-on-submit="onSubmit">
        <input d-field="email" name="email" type="text" value="" />
      </form>
    `);

    bind(formEl, { myForm, onSubmit });
    await tick(10);

    // Submit with empty email → should fail validation
    const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    formEl.dispatchEvent(event);
    await tick(10);

    assert.equal(submittedData, null, 'handler should not be called on invalid submit');
    assert.equal(myForm.error('email'), 'Required', 'validation error should be set');
  });
});

// ─── 8  d-array renders field array items ───────────────────────────────────

test('d-array renders items from field array', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () =>
      createForm({
        defaultValues: {
          phones: [
            { number: '555-1234' },
            { number: '555-5678' },
          ],
        },
      })
    );

    // Wait for defaults to resolve
    await tick(10);

    const formEl = el(doc, `
      <form d-form="myForm">
        <div d-array="phones">
          <div d-each="items">
            <input d-field="number" type="text" />
          </div>
        </div>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(50);

    const inputs = formEl.querySelectorAll('input[type="text"]');
    assert.equal(inputs.length, 2, 'should render 2 inputs from default values');
  });
});

// ─── 9  d-array append and remove operations ────────────────────────────────

test('d-array append button adds new items', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <div d-array="items">
          <div d-each="fields">
            <input d-field="name" type="text" />
            <button type="button" d-on-click="$remove">Remove</button>
          </div>
          <button d-append='{"name":""}'>Add</button>
        </div>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(20);

    // Initially empty
    let inputs = formEl.querySelectorAll('input[type="text"]');
    assert.equal(inputs.length, 0, 'should start empty');

    // Click append
    const addBtn = formEl.querySelector('[d-append]');
    addBtn.click();
    await tick(20);

    inputs = formEl.querySelectorAll('input[type="text"]');
    assert.equal(inputs.length, 1, 'should have 1 item after append');

    // Click append again
    addBtn.click();
    await tick(20);

    inputs = formEl.querySelectorAll('input[type="text"]');
    assert.equal(inputs.length, 2, 'should have 2 items after second append');
  });
});

// ─── 10  d-array item $remove works ─────────────────────────────────────────

test('d-array $remove removes the correct item', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <div d-array="items">
          <div d-each="fields">
            <input d-field="value" type="text" />
            <button type="button" d-on-click="$remove">Remove</button>
          </div>
          <button d-append='{"value":""}'>Add</button>
        </div>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(20);

    // Add 3 items
    const addBtn = formEl.querySelector('[d-append]');
    addBtn.click();
    await tick(20);
    addBtn.click();
    await tick(20);
    addBtn.click();
    await tick(20);

    let items = formEl.querySelectorAll('[data-array-key]');
    assert.equal(items.length, 3, 'should have 3 items');

    // Remove the middle item
    const removeButtons = formEl.querySelectorAll('button[d-on-click="$remove"]');
    assert.equal(removeButtons.length, 3, 'should have 3 remove buttons');

    removeButtons[1].click();
    await tick(20);

    items = formEl.querySelectorAll('[data-array-key]');
    assert.equal(items.length, 2, 'should have 2 items after remove');
  });
});

// ─── 11  Nested d-field paths inside d-array ────────────────────────────────

test('d-array sets correct nested paths on d-field elements', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <div d-array="phones">
          <div d-each="fields">
            <input d-field="number" type="tel" />
            <span d-error="number"></span>
          </div>
          <button d-append='{"number":""}'>Add</button>
        </div>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(20);

    // Add 2 items
    const addBtn = formEl.querySelector('[d-append]');
    addBtn.click();
    await tick(20);
    addBtn.click();
    await tick(20);

    const inputs = formEl.querySelectorAll('input[type="tel"]');
    assert.equal(inputs.length, 2);

    // Check that field paths are correctly set
    assert.equal(inputs[0].getAttribute('name'), 'phones[0].number');
    assert.equal(inputs[1].getAttribute('name'), 'phones[1].number');

    // Check data-field-path
    assert.equal(inputs[0].getAttribute('data-field-path'), 'phones[0].number');
    assert.equal(inputs[1].getAttribute('data-field-path'), 'phones[1].number');
  });
});

// ─── 12  Multiple forms on same page ────────────────────────────────────────

test('multiple forms on same page have independent errors', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const formA = withScope(scope, () => createForm());
    const formB = withScope(scope, () => createForm());

    const container = el(doc, `
      <div>
        <form d-form="formA">
          <input d-field="email" type="text" />
          <span d-error="email"></span>
        </form>
        <form d-form="formB">
          <input d-field="email" type="text" />
          <span d-error="email"></span>
        </form>
      </div>
    `);

    bind(container, { formA, formB });
    await tick(10);

    // Set error on form A only
    formA.setError('email', 'Error on A');
    await tick(10);

    const errors = container.querySelectorAll('[d-error]');
    assert.equal(errors[0].textContent, 'Error on A');
    assert.equal(errors[1].textContent, '', 'form B error should be empty');

    // Set error on form B
    formB.setError('email', 'Error on B');
    await tick(10);

    assert.equal(errors[0].textContent, 'Error on A');
    assert.equal(errors[1].textContent, 'Error on B');
  });
});

// ─── 13  d-error paths for d-array items ────────────────────────────────────

test('d-error inside d-array shows error for correct field path', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () => createForm());

    const formEl = el(doc, `
      <form d-form="myForm">
        <div d-array="phones">
          <div d-each="fields">
            <input d-field="number" type="tel" />
            <span d-error="number"></span>
          </div>
          <button d-append='{"number":""}'>Add</button>
        </div>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(20);

    // Add 2 items
    const addBtn = formEl.querySelector('[d-append]');
    addBtn.click();
    await tick(20);
    addBtn.click();
    await tick(20);

    // Set error on second item
    myForm.setError('phones[1].number', 'Phone is invalid');
    await tick(10);

    const errorSpans = formEl.querySelectorAll('[d-error]');
    assert.equal(errorSpans.length, 2);
    assert.equal(errorSpans[0].textContent, '', 'first item should have no error');
    assert.equal(errorSpans[1].textContent, 'Phone is invalid', 'second item should show error');
  });
});

// ─── 14  Nested d-array inside d-array (detached clone) ────────────────────

test('nested d-array inside d-array renders correctly', async () => {
  await withDom(async (doc) => {
    const scope = createScope();
    const myForm = withScope(scope, () =>
      createForm({
        defaultValues: {
          addresses: [
            { street: '123 Main St', phones: [{ number: '555-1234' }] },
          ],
        },
      })
    );

    // Wait for defaults to resolve
    await tick(10);

    const formEl = el(doc, `
      <form d-form="myForm">
        <div d-array="addresses">
          <div d-each="items">
            <input d-field="street" type="text" />
            <div d-array="phones">
              <div d-each="items">
                <input d-field="number" type="tel" />
              </div>
              <button d-append='{"number":""}'>Add Phone</button>
            </div>
          </div>
          <button d-append='{"street":"","phones":[]}'>Add Address</button>
        </div>
      </form>
    `);

    bind(formEl, { myForm });
    await tick(50);

    // Should render the outer array item
    const streetInputs = formEl.querySelectorAll('input[type="text"]');
    assert.equal(streetInputs.length, 1, 'should render 1 address');

    // Should render the nested phone inside that address
    const phoneInputs = formEl.querySelectorAll('input[type="tel"]');
    assert.equal(phoneInputs.length, 1, 'should render 1 nested phone');
  });
});
