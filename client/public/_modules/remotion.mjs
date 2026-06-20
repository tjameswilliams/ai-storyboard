// Bridge for `remotion` imports inside dynamically-loaded custom components.
// Re-exports the host bundle's Remotion singleton so the dynamic component
// participates in the same Player context (config, frame, etc.) instead of
// instantiating a second Remotion runtime.
const M = globalThis.__APP_BRIDGES__ && globalThis.__APP_BRIDGES__.remotion;
if (!M) {
  throw new Error(
    "[bridge] remotion not exposed at globalThis.__APP_BRIDGES__ — main bundle bootstrap missing or ran late.",
  );
}

// Hooks
export const useCurrentFrame = M.useCurrentFrame;
export const useVideoConfig = M.useVideoConfig;
export const useCurrentScale = M.useCurrentScale;
export const useBufferState = M.useBufferState;

// Animation primitives
export const interpolate = M.interpolate;
export const interpolateColors = M.interpolateColors;
export const spring = M.spring;
export const measureSpring = M.measureSpring;
export const Easing = M.Easing;
export const random = M.random;

// Layout / containers
export const AbsoluteFill = M.AbsoluteFill;
export const Sequence = M.Sequence;
export const Series = M.Series;
export const Loop = M.Loop;
export const Freeze = M.Freeze;
export const IFrame = M.IFrame;

// Media
export const Img = M.Img;
export const Audio = M.Audio;
export const Video = M.Video;
export const OffthreadVideo = M.OffthreadVideo;
export const Still = M.Still;
export const Composition = M.Composition;
export const Folder = M.Folder;

// Asset/static helpers
export const staticFile = M.staticFile;
export const watchStaticFile = M.watchStaticFile;
export const prefetch = M.prefetch;

// Lifecycle / render-control
export const delayRender = M.delayRender;
export const continueRender = M.continueRender;
export const cancelRender = M.cancelRender;

// Root registration / env
export const registerRoot = M.registerRoot;
export const getInputProps = M.getInputProps;
export const getRemotionEnvironment = M.getRemotionEnvironment;

// Internals (rare but some components reach in)
export const Internals = M.Internals;
