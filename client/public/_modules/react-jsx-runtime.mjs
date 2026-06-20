// Bridge for the automatic-JSX runtime that esbuild emits when compiling
// custom components on the server. Re-exports the host bundle's runtime.
const J = globalThis.__APP_BRIDGES__ && globalThis.__APP_BRIDGES__["react/jsx-runtime"];
if (!J) {
  throw new Error(
    "[bridge] react/jsx-runtime not exposed at globalThis.__APP_BRIDGES__ — main bundle bootstrap missing or ran late.",
  );
}

export const jsx = J.jsx;
export const jsxs = J.jsxs;
export const Fragment = J.Fragment;
