/**
 * Public AI-chat shares vary by provider and change often.  Keep the durable part of the
 * ingestion contract small: turn whatever visible transcript we can read into explicitly labelled
 * student and assistant turns, so the extractor can value them differently.
 */
const PROVIDERS = new Set(["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com"]);

/** A provider's own host: the link and every redirect while fetching it must stay on one. */
export const isAIChatHost = (host: string) => PROVIDERS.has(host.toLowerCase());

export function isPublicAIChatUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && PROVIDERS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function aiChatFilename(url?: string) {
  if (!url) return "AI chat — pasted transcript";
  const parsed = new URL(url);
  return `AI chat — ${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 255);
}

/** Basic visible-text extraction; role hints are added below rather than trusting scripts or JSON. */
export function visibleHtmlText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(?:p|div|li|article|section|h[1-6]|pre|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n\s*\n+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** The first lines of every transcript Orca stores: they tell the model how to weigh each speaker. */
const TRANSCRIPT_HEADER = ["AI CHAT TRANSCRIPT", "Student messages are the student's own questions or confusion. AI responses are non-authoritative context."];

/** Characters the chat itself contributes: the turns' text, without the header or the role labels. */
export function spokenChars(transcript: string) {
  return transcript
    .split("\n")
    .slice(TRANSCRIPT_HEADER.length)
    .reduce((sum, line) => sum + line.replace(/^(?:STUDENT|AI ASSISTANT|CHAT CONTEXT):\s*/, "").trim().length, 0);
}

const STUDENT = /^(?:#{1,6}\s*|\*{0,2})?(?:user|you|human|student|me)(?:\*{0,2})?\s*(?:message|said)?\s*[:：-]?\s*/i;
const ASSISTANT = /^(?:#{1,6}\s*|\*{0,2})?(?:assistant|chatgpt|claude|gemini|ai)(?:\*{0,2})?\s*(?:message|said)?\s*[:：-]?\s*/i;

function messagesFromExport(value: unknown) {
  const seen = new Set<unknown>();
  const messages: Array<{ role: "student" | "assistant"; text: string }> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const message = (record.message && typeof record.message === "object" ? record.message : record) as Record<string, unknown>;
    const rawRole = (message.author as Record<string, unknown> | undefined)?.role ?? message.role;
    const content = message.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts.filter((part): part is string => typeof part === "string") : [];
    const text = parts.join("\n") || (typeof message.text === "string" ? message.text : "");
    if (text && (rawRole === "user" || rawRole === "assistant")) messages.push({ role: rawRole === "user" ? "student" : "assistant", text });
    for (const child of Object.values(record)) walk(child);
  };
  walk(value);
  return messages;
}

/**
 * Preserve Markdown/log exports while making role detection deterministic for the model. Lines
 * without a role are retained as context instead of being silently attributed to either speaker.
 */
export function normaliseAIChatTranscript(raw: string) {
  try {
    const messages = messagesFromExport(JSON.parse(raw));
    if (messages.length) return [...TRANSCRIPT_HEADER, ...messages.map((m) => `${m.role === "student" ? "STUDENT" : "AI ASSISTANT"}: ${m.text}`)].join("\n").slice(0, 180_000);
  } catch { /* A normal pasted transcript is not JSON. */ }
  const lines = raw.replace(/\r/g, "").split("\n");
  let role: "student" | "assistant" | "context" = "context";
  const out: string[] = [...TRANSCRIPT_HEADER];
  for (const original of lines) {
    const line = original.trim();
    if (!line) continue;
    if (STUDENT.test(line)) {
      role = "student";
      out.push(`STUDENT: ${line.replace(STUDENT, "")}`);
      continue;
    }
    if (ASSISTANT.test(line)) {
      role = "assistant";
      out.push(`AI ASSISTANT: ${line.replace(ASSISTANT, "")}`);
      continue;
    }
    out.push(`${role === "student" ? "STUDENT" : role === "assistant" ? "AI ASSISTANT" : "CHAT CONTEXT"}: ${line}`);
  }
  return out.join("\n").slice(0, 180_000);
}

/** A best-effort fallback for public shares whose server HTML has no accessible role attributes. */
export function chatTextFromHtml(html: string) {
  const turns = [...html.matchAll(/<([a-z0-9]+)\b[^>]*data-message-author-role=["'](user|assistant)["'][^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => ({ role: match[2].toLowerCase() === "user" ? "STUDENT" : "AI ASSISTANT", text: visibleHtmlText(match[3]) }))
    .filter((turn) => turn.text);
  if (turns.length) return [...TRANSCRIPT_HEADER, ...turns.map((turn) => `${turn.role}: ${turn.text}`)].join("\n").slice(0, 180_000);
  return normaliseAIChatTranscript(visibleHtmlText(html));
}

export function isAIChatMaterial(filename: string) {
  return filename.toLowerCase().startsWith("ai chat —");
}
