import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";
import { executeToolCall } from "../toolExecutor";

let currentProjectId: string | null = null;

const server = new Server(
  { name: "ai-video-editor", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const exposedTools = [
  "get_project_status",
  "get_clip_info",
  "get_timeline_overview",
  "add_clip",
  "split_clip",
  "trim_clip",
  "move_clip",
  "delete_clip",
  "duplicate_clip",
  "add_track",
  "delete_track",
  "rename_track",
  "reorder_tracks",
  "set_track_volume",
  "set_track_enabled",
  "set_track_mute",
  "set_track_visibility",
  "extract_audio",
  "generate_video",
  "generate_image",
  "generate_tts",
  "generate_audio",
  "run_fflf_workflow",
  "compose_and_export",
  "add_marker",
  "list_markers",
  "delete_marker",
  "add_text_overlay",
  "add_shape_overlay",
  "add_image_overlay",
  "update_overlay",
  "delete_overlay",
  "list_overlays",
  "set_overlay_animation",
  "transcribe_track",
  "search_transcription",
  "search_transcript_semantic",
  "rename_speaker",
  "add_transition",
  "update_transition",
  "delete_transition",
  "list_transitions",
  "analyze_scenes",
  "get_scene_descriptions",
  "search_scenes",
  "describe_frame_at",
  "describe_asset_frame",
  "describe_last_frame",
  "extract_last_frame",
  "freeze_frame",
  "set_clip_lock",
  "set_clip_speed",
  "set_clip_fade",
  "set_clip_chroma_key",
];

const projectIdProp = {
  project_id: {
    type: "string" as const,
    description: "Project ID (uses active project if omitted)",
  },
};

const toolSchemas: Record<string, { description: string; inputSchema: Record<string, unknown> }> = {
  list_projects: {
    description: "List all projects.",
    inputSchema: { type: "object", properties: {} },
  },
  set_active_project: {
    description: "Set the active project for subsequent tool calls.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID to set as active" },
      },
      required: ["project_id"],
    },
  },
  get_project_status: {
    description: "Get the current project status: all tracks, clips, and positions.",
    inputSchema: { type: "object", properties: { ...projectIdProp } },
  },
  get_clip_info: {
    description: "Get detailed info about a specific clip.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, ...projectIdProp },
      required: ["clip_id"],
    },
  },
  get_timeline_overview: {
    description: "Get a bird's-eye view of the entire timeline.",
    inputSchema: { type: "object", properties: { ...projectIdProp } },
  },
  add_clip: {
    description: "Import a file as a new clip on a track.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        track_id: { type: "string" },
        track_name: { type: "string" },
        track_type: { type: "string", enum: ["video", "audio"] },
        offset: { type: "number" },
        ...projectIdProp,
      },
      required: ["file_path"],
    },
  },
  split_clip: {
    description: "Split a clip at a specific time point.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, time: { type: "number" }, ...projectIdProp },
      required: ["clip_id", "time"],
    },
  },
  trim_clip: {
    description: "Set in/out points of a clip.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, trim_start: { type: "number" }, trim_end: { type: "number" }, ...projectIdProp },
      required: ["clip_id"],
    },
  },
  move_clip: {
    description: "Move a clip to a new timeline position.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, offset: { type: "number" }, track_id: { type: "string" }, ...projectIdProp },
      required: ["clip_id", "offset"],
    },
  },
  delete_clip: {
    description: "Remove a clip from the timeline.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, ...projectIdProp },
      required: ["clip_id"],
    },
  },
  duplicate_clip: {
    description: "Create a copy of a clip.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, offset: { type: "number" }, ...projectIdProp },
      required: ["clip_id"],
    },
  },
  add_track: {
    description: "Create a new empty track.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, type: { type: "string", enum: ["video", "audio"] }, ...projectIdProp },
      required: ["name", "type"],
    },
  },
  delete_track: {
    description: "Delete a track and all its clips.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, ...projectIdProp },
      required: ["track_id"],
    },
  },
  rename_track: {
    description: "Rename a track.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, name: { type: "string" }, ...projectIdProp },
      required: ["track_id", "name"],
    },
  },
  reorder_tracks: {
    description: "Reorder tracks.",
    inputSchema: {
      type: "object",
      properties: { track_ids: { type: "array", items: { type: "string" } }, ...projectIdProp },
      required: ["track_ids"],
    },
  },
  set_track_volume: {
    description: "Set track volume.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, volume: { type: "number" }, ...projectIdProp },
      required: ["track_id", "volume"],
    },
  },
  set_track_enabled: {
    description: "Enable or disable a track (mute + hide in one call).",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, enabled: { type: "boolean" }, ...projectIdProp },
      required: ["track_id", "enabled"],
    },
  },
  set_track_mute: {
    description: "Mute or unmute a track's audio only.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, muted: { type: "boolean" }, ...projectIdProp },
      required: ["track_id", "muted"],
    },
  },
  set_track_visibility: {
    description: "Show or hide a video track.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, visible: { type: "boolean" }, ...projectIdProp },
      required: ["track_id", "visible"],
    },
  },
  extract_audio: {
    description: "Extract audio from a video clip into a new audio track.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" }, track_name: { type: "string" }, ...projectIdProp },
      required: ["clip_id"],
    },
  },
  generate_video: {
    description: "Generate a video using the configured generation plugin. Supports T2V, I2V, and IA2V (image+audio to video). For IA2V you MUST also pass `audio_duration` (seconds) — ComfyUI does not auto-derive video length from the audio file; the workflow uses audio_duration to clip the audio and derive frame count.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" }, width: { type: "number" }, height: { type: "number" }, frames: { type: "number" }, source_clip_id: { type: "string" }, start_frame: { type: "string" }, source_audio: { type: "string" }, source_audio_clip_id: { type: "string" }, audio_duration: { type: "number", description: "Required for IA2V — duration in seconds of the source audio to drive the video." }, ...projectIdProp },
      required: ["prompt"],
    },
  },
  generate_image: {
    description: "Generate an image using the configured generation plugin.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" }, width: { type: "number" }, height: { type: "number" }, ...projectIdProp },
      required: ["prompt"],
    },
  },
  generate_tts: {
    description: "Generate speech from text using a TTS workflow with voice cloning.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, voice_file: { type: "string" }, ...projectIdProp },
      required: ["text"],
    },
  },
  generate_audio: {
    description: "Generate audio using the configured generation plugin.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" }, duration: { type: "number" }, ...projectIdProp },
      required: ["prompt"],
    },
  },
  run_fflf_workflow: {
    description: "Generate a video by interpolating motion between a first frame and a last frame (FFLF). Both frames are required — start_frame + end_frame as paths (bare filenames from generate_image work directly), or source_clip_id (uses the clip's last frame) with end_frame.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        source_clip_id: { type: "string" },
        start_frame: { type: "string" },
        end_frame: { type: "string" },
        frames: { type: "number" },
        fps: { type: "number" },
        ...projectIdProp,
      },
      required: ["prompt", "end_frame"],
    },
  },
  compose_and_export: {
    description: "Render timeline to output video file with optional resolution and quality overrides.",
    inputSchema: {
      type: "object",
      properties: { format: { type: "string" }, quality: { type: "string" }, resolution: { type: "string" }, ...projectIdProp },
    },
  },
  add_marker: {
    description: "Add a timeline marker.",
    inputSchema: {
      type: "object",
      properties: { time: { type: "number" }, name: { type: "string" }, color: { type: "string" }, ...projectIdProp },
      required: ["time"],
    },
  },
  list_markers: {
    description: "List all markers.",
    inputSchema: { type: "object", properties: { ...projectIdProp } },
  },
  delete_marker: {
    description: "Delete a marker.",
    inputSchema: {
      type: "object",
      properties: { marker_id: { type: "string" }, ...projectIdProp },
      required: ["marker_id"],
    },
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = Object.entries(toolSchemas).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === "list_projects") {
    const projects = await db.select().from(schema.projects);
    return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
  }

  if (name === "set_active_project") {
    const projectId = args.project_id as string;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) {
      return { content: [{ type: "text", text: `Project "${projectId}" not found.` }], isError: true };
    }
    currentProjectId = projectId;
    return { content: [{ type: "text", text: `Active project set to "${project.name}" (${projectId})` }] };
  }

  const projectId = (args.project_id as string) || currentProjectId;
  if (!projectId) {
    return {
      content: [{ type: "text", text: "No project selected. Use set_active_project or pass project_id." }],
      isError: true,
    };
  }

  if (!exposedTools.includes(name)) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  const toolArgs = { ...args };
  delete toolArgs.project_id;

  const result = await executeToolCall(name, toolArgs as Record<string, unknown>, projectId);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: !result.success,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
