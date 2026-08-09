import { test } from "node:test";
import assert from "node:assert/strict";

import { speakableFrom } from "../speakable";
import { chunkForSpeech } from "../browser-playback";

test("emphasis markers are not read out", () => {
  assert.equal(
    speakableFrom("This is **critical** and _urgent_."),
    "This is critical and urgent.",
  );
});

test("an unpaired asterisk is left alone", () => {
  // Arithmetic and snake_case identifiers are ordinary content in this app's
  // answers; stripping every marker would eat them.
  assert.equal(speakableFrom("2 * 3 in api_key_rotation"), "2 * 3 in api_key_rotation");
});

test("inline code is spoken without its backticks", () => {
  assert.equal(
    speakableFrom("Check `NEXT_PUBLIC_API_BASE_URL` first."),
    "Check NEXT_PUBLIC_API_BASE_URL first.",
  );
});

test("a link is said by its words, never its target", () => {
  const spoken = speakableFrom("See [the advisory](https://example.com/cve-2024-1234).");
  assert.equal(spoken, "See the advisory.");
  assert.ok(!spoken.includes("http"));
});

test("a bare URL is named rather than spelled", () => {
  const spoken = speakableFrom("It is at https://example.com/a/b?c=d now.");
  assert.equal(spoken, "It is at the link now.");
});

test("a fenced block is described instead of recited", () => {
  const spoken = speakableFrom("Run this:\n\n```bash\nnpm run build --verbose\n```\n");
  assert.ok(!spoken.includes("npm run build"));
  assert.ok(spoken.startsWith("Run this"));
  assert.ok(/chat\.$/.test(spoken));
});

test("an answer that is only a code block still says something", () => {
  // Returning "" here would leave the session waiting on speech that never
  // starts, which is the deadlock the thinking watchdog exists for.
  assert.notEqual(speakableFrom("```\nrm -rf node_modules\n```"), "");
});

test("headings, bullets and quotes become sentences", () => {
  const spoken = speakableFrom("## Findings\n\n- One thing\n- Another thing\n\n> A quote");
  assert.ok(!spoken.includes("#"));
  assert.ok(!spoken.includes("-"));
  assert.ok(!spoken.includes(">"));
  assert.ok(spoken.includes("One thing"));
  assert.ok(spoken.includes("Another thing"));
});

test("table pipes become pauses, not vertical bars", () => {
  const spoken = speakableFrom("| High | 3 |\n| Low | 8 |");
  assert.ok(!spoken.includes("|"));
  assert.ok(spoken.includes("High"));
  assert.ok(spoken.includes("Low"));
});

test("run-together punctuation is collapsed", () => {
  const spoken = speakableFrom("One.\n\n\nTwo.\n\nThree.");
  assert.ok(!/\.\s*\./.test(spoken), spoken);
});

test("empty and whitespace input speak nothing", () => {
  assert.equal(speakableFrom(""), "");
  assert.equal(speakableFrom("   \n\n  "), "");
});

test("chunks stay under the engine's stall length", () => {
  const answer = speakableFrom(
    "The reachability report is open on the left. " +
      "Three of the eleven advisories reach production code paths. " +
      "The other eight are transitive and unreachable from any entry point. " +
      "I have put the two internet-facing ones at the top of the matrix.",
  );
  const chunks = chunkForSpeech(answer);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 180, chunk);
});

test("chunking loses no words", () => {
  const line =
    "One sentence here. A second, rather longer sentence that carries the detail. A third.";
  const rejoined = chunkForSpeech(line, 40).join(" ").replace(/\s+/g, " ");
  assert.equal(rejoined, line);
});

test("a single sentence longer than the limit is split rather than dropped", () => {
  const line = `${"word ".repeat(80).trim()}.`;
  const chunks = chunkForSpeech(line, 60);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 60, chunk);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), line);
});

test("a short answer stays one utterance", () => {
  assert.deepEqual(chunkForSpeech("Done."), ["Done."]);
});
