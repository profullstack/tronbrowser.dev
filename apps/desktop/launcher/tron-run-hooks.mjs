// ESM resolver hook for `tron run`: maps the bare `@tronbrowser/*` specifiers a
// user script imports to the runtime shipped in the launcher payload, so scripts
// need no node_modules of their own. Registered by tron-run.mjs.
let map = {};

export async function initialize(data) {
  map = data ?? {};
}

export async function resolve(specifier, context, next) {
  if (Object.prototype.hasOwnProperty.call(map, specifier)) {
    return { url: map[specifier], shortCircuit: true };
  }
  return next(specifier, context);
}
