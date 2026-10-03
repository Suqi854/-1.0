/**
 * Never read caller properties, call getters, toJSON, or coercion hooks.
 * Node can reject Proxy objects without traps. Browsers lack that primitive:
 * their public entrypoints accept JSON text only, without inspecting objects.
 */
const detectProxy = typeof process !== 'undefined' && process.release?.name === 'node'
  ? (await import('node:util')).types.isProxy : null;
const MAX_VISITS = 10_000_000;
const MAX_DEPTH = 32;
const MAX_TEXT_LENGTH = 128 * 1024 * 1024;
const fail = (code, path) => ({ valid: false, error: { code, message: '输入必须是有界纯JSON；拒绝访问器、代理、自定义原型、继承字段和非JSON值', path } });
export function readJSONInput(input) {
  let root = input;
  if (typeof input === 'string') {
    if (input.length > MAX_TEXT_LENGTH) return fail('JSON_INPUT_BOUNDS', '$');
    try { root = JSON.parse(input); } catch { return fail('JSON_PARSE_ERROR', '$'); }
  } else if (!detectProxy) {
    // No reflection on browser caller objects: even getPrototypeOf can execute a Proxy trap.
    return fail('JSON_TEXT_REQUIRED', '$');
  }
  const active = new WeakSet(), copies = new WeakMap(); let visits = 0;
  function copy(value, path, depth) {
    if (++visits > MAX_VISITS || depth > MAX_DEPTH) throw fail('JSON_INPUT_BOUNDS', path);
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') { if (Number.isFinite(value)) return value; throw fail('NON_JSON_NUMBER', path); }
    if (typeof value !== 'object') throw fail('NON_JSON_VALUE', path);
    if (detectProxy?.(value)) throw fail('JSON_PROXY_REJECTED', path);
    if (active.has(value)) throw fail('JSON_CYCLE_REJECTED', path);
    if (copies.has(value)) return copies.get(value);
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw fail('JSON_PROTOTYPE_REJECTED', path);
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length > 50_000) throw fail('JSON_INPUT_BOUNDS', path);
    for (const name of names) {
      const d = descriptors[name];
      if (typeof name !== 'string') throw fail('JSON_SYMBOL_KEY_REJECTED', path);
      if (!Object.prototype.hasOwnProperty.call(d, 'value')) throw fail('JSON_ACCESSOR_REJECTED', `${path}.${name}`);
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') throw fail('JSON_RESERVED_KEY_REJECTED', `${path}.${name}`);
      if (!d.enumerable && !(array && name === 'length')) throw fail('JSON_NON_ENUMERABLE_REJECTED', `${path}.${name}`);
    }
    const result = array ? [] : Object.create(null);
    active.add(value); copies.set(value, result);
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isInteger(length) || length < 0 || length > 24_000 || names.length !== length + 1) throw fail('JSON_ARRAY_REJECTED', path);
      for (let i = 0; i < length; i++) {
        const d = descriptors[String(i)];
        if (!d) throw fail('JSON_ARRAY_REJECTED', path);
        result.push(copy(d.value, `${path}[${i}]`, depth + 1));
      }
    } else {
      for (const name of names) Object.defineProperty(result, name, { value: copy(descriptors[name].value, `${path}.${name}`, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    active.delete(value);
    return result;
  }
  try { return { valid: true, value: copy(root, '$', 0) }; }
  catch (error) { return error?.valid === false ? error : fail('JSON_INPUT_REJECTED', '$'); }
}
