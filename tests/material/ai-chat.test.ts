import assert from "node:assert/strict";
import test from "node:test";
import { aiChatFilename, chatPages, chatTextFromHtml, isPublicAIChatUrl, normaliseAIChatTranscript, spokenChars } from "../../src/lib/material/ai-chat.ts";

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

test("only the chat's own text counts toward enough to import, not Orca's header or role labels", () => {
  // A share page whose chat is rendered by script: visible text is just the app's name.
  const empty = chatTextFromHtml("<html><body><div>ChatGPT</div><script>{\"huge\":\"app state\"}</script></body></html>");
  assert.ok(empty.length > 80);
  assert.equal(spokenChars(empty), 0);
  assert.equal(spokenChars(normaliseAIChatTranscript("You: What is a heap?\nChatGPT: A tree with the heap property.")), "What is a heap?".length + "A tree with the heap property.".length);
});

test("AI-chat public-share HTML retains provider role attributes", () => {
  const text = chatTextFromHtml('<div data-message-author-role="user"><p>What is a hash collision?</p></div><div data-message-author-role="assistant"><p>Two keys map to the same slot.</p></div>');
  assert.match(text, /STUDENT: What is a hash collision/);
  assert.match(text, /AI ASSISTANT: Two keys map/);
});

test("a long pasted chat is kept whole, split into pages at line breaks, each with the header", () => {
  const turns = Array.from({ length: 4000 }, (_, i) => `${i % 2 ? "ChatGPT" : "You"}: turn ${i} ${"x".repeat(60)}`).join("\n");
  const transcript = normaliseAIChatTranscript(turns);
  assert.ok(transcript.length > 180_000);
  assert.match(transcript, /turn 3999 /);
  const pages = chatPages(transcript, 12_000);
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(page.startsWith("AI CHAT TRANSCRIPT\n"));
    assert.ok(page.length <= 12_000 + 200);
  }
  assert.equal(pages.reduce((sum, page) => sum + spokenChars(page), 0), spokenChars(transcript));
  // One line longer than a page is cut into pieces, not dropped.
  const long = chatPages(normaliseAIChatTranscript(`You: ${"y".repeat(30_000)}`), 12_000);
  assert.equal(long.length, 3);
  assert.equal(long.reduce((sum, page) => sum + spokenChars(page), 0), 30_000);
});
