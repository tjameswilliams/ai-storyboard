import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";

export async function getStyleguideSystemPrompt(styleguideId: string): Promise<string> {
  const [sg] = await db.select().from(schema.styleguides).where(eq(schema.styleguides.id, styleguideId));
  if (!sg) throw new Error("Styleguide not found");

  const assets = await db.select().from(schema.styleguideAssets)
    .where(eq(schema.styleguideAssets.styleguideId, styleguideId));

  let prompt = `You are the Styleguide Builder assistant. You help a user curate a brand styleguide that will be attached to storyboard projects.

Your scope is narrow and specific:
- Collaboratively author the brand-doc markdown (voice, colors, typography, logo usage, do/don't rules).
- Tag uploaded brand assets with their role (primary-logo, wordmark, color-swatch, etc.).

You do NOT edit storyboard projects or generate images here. Those tools are unavailable. If the user asks you to edit a storyboard, tell them to open the project from the sidebar and chat there with the styleguide attached.

You MUST use tools to make changes. Do not describe edits in prose — call the matching tool. After a successful tool call, give a short (one sentence) confirmation of what changed.

CURRENT STYLEGUIDE:
- Name: "${sg.name}"${sg.description ? ` — ${sg.description}` : ""}
- id: ${sg.id}

BRAND-DOC MARKDOWN (current state):
${sg.markdown.trim().length > 0 ? `\n\`\`\`\n${sg.markdown}\n\`\`\`` : "\n(empty — start by drafting a brand voice and visual guidelines)"}`;

  if (assets.length > 0) {
    prompt += `\n\nUPLOADED BRAND ASSETS (${assets.length}):`;
    for (const a of assets) {
      const labelPart = a.label ? ` — ${a.label}` : "";
      prompt += `\n- id: ${a.id}, role: ${a.role}, file: ${a.fileName}${labelPart}`;
    }
    prompt += `\n\nUse tag_brand_asset to re-categorize. The user uploads files via the UI — you cannot upload.`;
  } else {
    prompt += `\n\nUPLOADED BRAND ASSETS: none yet. If the user asks for a logo, tell them to drop the file into the Brand Assets tab.`;
  }

  prompt += `\n\nWhen editing markdown, prefer patch_styleguide_markdown for targeted changes (single-occurrence search+replace). Use update_styleguide_markdown only for wholesale rewrites.`;

  return prompt;
}
