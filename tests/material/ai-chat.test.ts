import assert from "node:assert/strict";
import test from "node:test";
import { aiChatFilename, chatTextFromHtml, isPublicAIChatUrl, normaliseAIChatTranscript } from "../../src/lib/material/ai-chat.ts";

test("AI-chat intake accepts only supported public-share providers", () => {
  assert.equal(isPublicAIChatUrl("https://chatgpt.com/share/abc"), true);
  assert.equal(isPublicAIChatUrl("https://claude.ai/share/abc"), true);
  assert.equal(isPublicAIChatUrl("https://example.com/share/abc"), false);
  assert.equal(isPublicAIChatUrl("http://chatgpt.com/share/abc"), false);
  assert.equal(aiChatFilename("https://chatgpt.com/share/abc"), "AI chat — chatgpt.com/share/abc");
});

test("AI-chat intake labels pasted markdown and ChatGPT-style export turns", () => {
  const pasted = normaliseAIChatTranscript("## You\nWhy does a heap have O(log n) insertion?\n\n## ChatGPT\nBecause it bubbles up.");
  assert.match(pasted, /STUDENT: Why does a heap/);
  assert.match(pasted, /AI ASSISTANT: Because it bubbles up/);
  const exported = normaliseAIChatTranscript(JSON.stringify({ mapping: { a: { message: { author: { role: "user" }, content: { parts: ["Explain recursion"] } } }, b: { message: { author: { role: "assistant" }, content: { parts: ["It calls itself."] } } } } }));
  assert.match(exported, /STUDENT: Explain recursion/);
  assert.match(exported, /AI ASSISTANT: It calls itself/);
});

test("AI-chat public-share HTML retains provider role attributes", () => {
  const text = chatTextFromHtml('<div data-message-author-role="user"><p>What is a hash collision?</p></div><div data-message-author-role="assistant"><p>Two keys map to the same slot.</p></div>');
  assert.match(text, /STUDENT: What is a hash collision/);
  assert.match(text, /AI ASSISTANT: Two keys map/);
});
