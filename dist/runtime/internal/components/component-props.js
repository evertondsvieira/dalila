import { effect, signal } from '../../../core/signal.js';
import { camelToKebab, coercePropValue, normalizePropDef } from '../../component.js';
export function resolveComponentProps(el, parentCtx, def, deps) {
    const props = {};
    const schema = def.props ?? {};
    const hasSchema = Object.keys(schema).length > 0;
    const PREFIX = 'd-props-';
    for (const attr of Array.from(el.attributes)) {
        if (!attr.name.startsWith(PREFIX))
            continue;
        const kebab = attr.name.slice(PREFIX.length);
        const propName = kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (hasSchema && !(propName in schema)) {
            deps.warn(`Component <${def.tag}>: d-props-${kebab} is not declared in props schema`);
        }
        const bindingName = deps.normalizeBinding(attr.value);
        if (!bindingName)
            continue;
        const parentValue = parentCtx[bindingName];
        if (parentValue === undefined) {
            deps.warn(`d-props-${kebab}: "${bindingName}" not found in parent context`);
        }
        const isGetter = !deps.isSignal(parentValue) &&
            typeof parentValue === 'function' &&
            parentValue.length === 0;
        const raw = deps.isSignal(parentValue)
            ? parentValue()
            : isGetter
                ? parentValue()
                : parentValue;
        const propSignal = signal(raw);
        if (deps.isSignal(parentValue) || isGetter) {
            effect(() => {
                propSignal.set(deps.isSignal(parentValue) ? parentValue() : parentValue());
            });
        }
        props[propName] = propSignal;
    }
    for (const [propName, propOption] of Object.entries(schema)) {
        if (props[propName])
            continue;
        const propDef = normalizePropDef(propOption);
        const kebabPropName = camelToKebab(propName);
        const attrName = el.hasAttribute(propName)
            ? propName
            : (el.hasAttribute(kebabPropName) ? kebabPropName : null);
        if (attrName) {
            const raw = el.getAttribute(attrName);
            if (propDef.type === Array || propDef.type === Object) {
                deps.warn(`Component <${def.tag}>: prop "${propName}" has type ${propDef.type === Array ? 'Array' : 'Object'} ` +
                    `but received a static string attribute. Use d-props-${camelToKebab(propName)} to pass reactive data.`);
            }
            props[propName] = signal(coercePropValue(raw, propDef.type));
        }
        else if (propDef.default !== undefined) {
            const defaultValue = typeof propDef.default === 'function'
                ? propDef.default()
                : propDef.default;
            props[propName] = signal(defaultValue);
        }
        else {
            if (propDef.required) {
                deps.warn(`Component <${def.tag}>: required prop "${propName}" was not provided`);
            }
            props[propName] = signal(undefined);
        }
    }
    return props;
}
