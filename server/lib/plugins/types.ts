export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: "video-generator" | "image-generator" | "audio-generator" | "tts-generator";
  description: string;
}

export interface VideoGenerationParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  startFrame?: string;
  endFrame?: string;
  sourceAudio?: string;
  audioDuration?: number;
  seed?: number;
  workflowId?: string;
  cfg?: number;
}

export interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  inputImage?: string;
  workflowId?: string;
  cfg?: number;
}

export interface AudioGenerationParams {
  prompt: string;
  tags?: string;
  lyrics?: string;
  duration?: number;
  sampleRate?: number;
  seed?: number;
  workflowId?: string;
}

export interface GenerationResult {
  success: boolean;
  filePath?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigSchema {
  properties: Record<string, {
    type: "string" | "number" | "boolean";
    description: string;
    default?: unknown;
    required?: boolean;
  }>;
}

export interface VideoGeneratorPlugin {
  manifest: PluginManifest;
  initialize(config: Record<string, unknown>): Promise<void>;
  generateVideo(params: VideoGenerationParams): Promise<GenerationResult>;
  getConfigSchema(): ConfigSchema;
  healthCheck(): Promise<boolean>;
}

export interface ImageGeneratorPlugin {
  manifest: PluginManifest;
  initialize(config: Record<string, unknown>): Promise<void>;
  generateImage(params: ImageGenerationParams): Promise<GenerationResult>;
  getConfigSchema(): ConfigSchema;
  healthCheck(): Promise<boolean>;
}

export interface AudioGeneratorPlugin {
  manifest: PluginManifest;
  initialize(config: Record<string, unknown>): Promise<void>;
  generateAudio(params: AudioGenerationParams): Promise<GenerationResult>;
  getConfigSchema(): ConfigSchema;
  healthCheck(): Promise<boolean>;
}

export interface TTSGenerationParams {
  text: string;
  voiceFile?: string;
  seed?: number;
  workflowId?: string;
}

export interface TTSGeneratorPlugin {
  manifest: PluginManifest;
  initialize(config: Record<string, unknown>): Promise<void>;
  generateTTS(params: TTSGenerationParams): Promise<GenerationResult>;
  getConfigSchema(): ConfigSchema;
  healthCheck(): Promise<boolean>;
}
