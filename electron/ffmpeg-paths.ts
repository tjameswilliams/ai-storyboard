// AI Storyboard does not process video/audio, so no bundled ffmpeg is needed.
// These stubs keep the server's config.configure() signature satisfied.
export function getFfmpegPaths(): { ffmpeg: string; ffprobe: string } {
  return { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
}
