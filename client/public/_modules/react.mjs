// Bridge module for dynamically-imported custom components.
// Re-exports the React singleton already loaded by the main bundle, so
// the dynamic component shares hooks/contexts with the host app.
// Populated by client/src/main.tsx at boot.
const R = globalThis.__APP_BRIDGES__ && globalThis.__APP_BRIDGES__.react;
if (!R) {
  throw new Error(
    "[bridge] React not exposed at globalThis.__APP_BRIDGES__.react — main bundle bootstrap missing or ran late.",
  );
}

export default R.default || R;

export const useState = R.useState;
export const useEffect = R.useEffect;
export const useLayoutEffect = R.useLayoutEffect;
export const useMemo = R.useMemo;
export const useCallback = R.useCallback;
export const useRef = R.useRef;
export const useContext = R.useContext;
export const useReducer = R.useReducer;
export const useImperativeHandle = R.useImperativeHandle;
export const useDebugValue = R.useDebugValue;
export const useDeferredValue = R.useDeferredValue;
export const useTransition = R.useTransition;
export const useId = R.useId;
export const useSyncExternalStore = R.useSyncExternalStore;
export const useInsertionEffect = R.useInsertionEffect;

export const createContext = R.createContext;
export const createElement = R.createElement;
export const cloneElement = R.cloneElement;
export const createRef = R.createRef;
export const isValidElement = R.isValidElement;

export const Fragment = R.Fragment;
export const Children = R.Children;
export const StrictMode = R.StrictMode;
export const Suspense = R.Suspense;
export const Component = R.Component;
export const PureComponent = R.PureComponent;

export const memo = R.memo;
export const forwardRef = R.forwardRef;
export const lazy = R.lazy;
export const startTransition = R.startTransition;
export const version = R.version;
