export function extractSlots(el) {
    const getSlotName = (node) => {
        const raw = node.getAttribute('d-slot') ?? node.getAttribute('slot');
        if (!raw)
            return null;
        const name = raw.trim();
        return name || null;
    };
    const namedSlots = new Map();
    const defaultSlot = document.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
        if (child instanceof Element && child.tagName === 'TEMPLATE') {
            const name = getSlotName(child);
            if (name) {
                const frag = namedSlots.get(name) ?? document.createDocumentFragment();
                frag.append(...Array.from(child.content.childNodes));
                namedSlots.set(name, frag);
            }
            else {
                defaultSlot.appendChild(child);
            }
        }
        else if (child instanceof Element) {
            const name = getSlotName(child);
            if (name) {
                const frag = namedSlots.get(name) ?? document.createDocumentFragment();
                child.removeAttribute('d-slot');
                child.removeAttribute('slot');
                frag.appendChild(child);
                namedSlots.set(name, frag);
            }
            else {
                defaultSlot.appendChild(child);
            }
        }
        else {
            defaultSlot.appendChild(child);
        }
    }
    return { defaultSlot, namedSlots };
}
export function fillSlots(root, defaultSlot, namedSlots) {
    for (const slotEl of Array.from(root.querySelectorAll('slot[name]'))) {
        const name = slotEl.getAttribute('name');
        const content = namedSlots.get(name);
        if (content && content.childNodes.length > 0)
            slotEl.replaceWith(content);
    }
    const defaultSlotEl = root.querySelector('slot:not([name])');
    if (defaultSlotEl && defaultSlot.childNodes.length > 0)
        defaultSlotEl.replaceWith(defaultSlot);
}
export function bindSlotFragments(defaultSlot, namedSlots, parentCtx, events, cleanups, bindFragmentRoot) {
    const bindFrag = (frag) => {
        if (frag.childNodes.length === 0)
            return;
        const container = document.createElement('div');
        container.setAttribute('data-dalila-internal-bound', '');
        container.appendChild(frag);
        const handle = bindFragmentRoot(container, parentCtx, { events, _skipLifecycle: true, _internal: true });
        cleanups.push(handle);
        while (container.firstChild)
            frag.appendChild(container.firstChild);
    };
    bindFrag(defaultSlot);
    for (const frag of namedSlots.values())
        bindFrag(frag);
}
