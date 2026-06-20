import type {
  PluginManifest,
  VideoGeneratorPlugin,
  ImageGeneratorPlugin,
  AudioGeneratorPlugin,
  TTSGeneratorPlugin,
} from "./types";

class PluginRegistry {
  private videoGenerators = new Map<string, VideoGeneratorPlugin>();
  private imageGenerators = new Map<string, ImageGeneratorPlugin>();
  private audioGenerators = new Map<string, AudioGeneratorPlugin>();
  private ttsGenerators = new Map<string, TTSGeneratorPlugin>();
  private defaultVideoGenerator: string | null = null;
  private defaultImageGenerator: string | null = null;
  private defaultAudioGenerator: string | null = null;
  private defaultTTSGenerator: string | null = null;

  registerVideoGenerator(plugin: VideoGeneratorPlugin): void {
    this.videoGenerators.set(plugin.manifest.id, plugin);
    if (!this.defaultVideoGenerator) this.defaultVideoGenerator = plugin.manifest.id;
  }

  registerImageGenerator(plugin: ImageGeneratorPlugin): void {
    this.imageGenerators.set(plugin.manifest.id, plugin);
    if (!this.defaultImageGenerator) this.defaultImageGenerator = plugin.manifest.id;
  }

  registerAudioGenerator(plugin: AudioGeneratorPlugin): void {
    this.audioGenerators.set(plugin.manifest.id, plugin);
    if (!this.defaultAudioGenerator) this.defaultAudioGenerator = plugin.manifest.id;
  }

  registerTTSGenerator(plugin: TTSGeneratorPlugin): void {
    this.ttsGenerators.set(plugin.manifest.id, plugin);
    if (!this.defaultTTSGenerator) this.defaultTTSGenerator = plugin.manifest.id;
  }

  getVideoGenerator(id?: string): VideoGeneratorPlugin | null {
    if (id) return this.videoGenerators.get(id) || null;
    if (this.defaultVideoGenerator) return this.videoGenerators.get(this.defaultVideoGenerator) || null;
    return null;
  }

  getImageGenerator(id?: string): ImageGeneratorPlugin | null {
    if (id) return this.imageGenerators.get(id) || null;
    if (this.defaultImageGenerator) return this.imageGenerators.get(this.defaultImageGenerator) || null;
    return null;
  }

  getAudioGenerator(id?: string): AudioGeneratorPlugin | null {
    if (id) return this.audioGenerators.get(id) || null;
    if (this.defaultAudioGenerator) return this.audioGenerators.get(this.defaultAudioGenerator) || null;
    return null;
  }

  getTTSGenerator(id?: string): TTSGeneratorPlugin | null {
    if (id) return this.ttsGenerators.get(id) || null;
    if (this.defaultTTSGenerator) return this.ttsGenerators.get(this.defaultTTSGenerator) || null;
    return null;
  }

  listPlugins(): PluginManifest[] {
    const all: PluginManifest[] = [];
    for (const p of this.videoGenerators.values()) all.push(p.manifest);
    for (const p of this.imageGenerators.values()) all.push(p.manifest);
    for (const p of this.audioGenerators.values()) all.push(p.manifest);
    for (const p of this.ttsGenerators.values()) all.push(p.manifest);
    return all;
  }

  listImageGenerators(): PluginManifest[] {
    return Array.from(this.imageGenerators.values()).map((p) => p.manifest);
  }
}

export const pluginRegistry = new PluginRegistry();

// Auto-register built-in image generation plugins. Storyboard is image-only;
// the video/audio/tts plugins from the sister project are not bundled here.
import { ComfyUIImagePlugin } from "./comfyui-image";
import { NanoBananaPlugin } from "./nano-banana";

const imagePlugin = new ComfyUIImagePlugin();
const nanoBananaPlugin = new NanoBananaPlugin();

pluginRegistry.registerImageGenerator(imagePlugin);
pluginRegistry.registerImageGenerator(nanoBananaPlugin);
