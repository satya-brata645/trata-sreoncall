/**
 * Turning a written answer into something worth hearing.
 *
 * The model writes for a chat window: bold for emphasis, bullets for lists,
 * backticks around identifiers, fenced blocks for output, links with their
 * URLs attached. A synthesis engine has no idea any of that is markup — it
 * reads the asterisks aloud, spells `https://` one character at a time, and
 * recites an entire code block as words. That is the difference between the
 * agent sounding like it is talking to you and it sounding broken.
 *
 * Deliberately lossy. This is not a markdown renderer; it is the answer to
 * "what would a person reading this out actually say", which means fenced
 * blocks are described rather than read, link targets are dropped in favour of
 * their text, and table pipes become pauses.
 *
 * Pure and dependency-free so it can be tested without a DOM or an engine.
 */

/** Long enough to be worth naming rather than reading. */
const CODE_BLOCK_PLACEHOLDER = "I have put the code in the chat.";

function stripFences(text: string): { text: string; hadBlock: boolean } {
  let hadBlock = false;
  const withoutBlocks = text.replace(/```[\s\S]*?(?:```|$)/g, () => {
    hadBlock = true;
    return " ";
  });
  return { text: withoutBlocks, hadBlock };
}

export function speakableFrom(input: string): string {
  if (!input) return "";

  const { text: withoutFences, hadBlock } = stripFences(input);

  const spoken = withoutFences
    // Images carry no spoken content at all; their alt text is not a sentence.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links: say the words, never the target.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Inline code is usually an identifier — worth saying, not worth spelling
    // its backticks.
    .replace(/`([^`]+)`/g, "$1")
    // Emphasis markers, but only paired ones, so `2 * 3` survives.
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*]*?\S)\*/g, "$1")
    // Underscores only at word boundaries, or `api_key_rotation` and every
    // other snake_case identifier in a security answer loses its middle.
    .replace(/(?<![\w])__(?=\S)([\s\S]*?\S)__(?![\w])/g, "$1")
    .replace(/(?<![\w])_(?=\S)([^_]*?\S)_(?![\w])/g, "$1")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    // Headings and block quotes are structure, not speech.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    // A horizontal rule read aloud is three dashes.
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, " ")
    // List markers become sentence breaks so the engine pauses between items
    // instead of running them together.
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    // Table rows: pipes are column breaks, which sound like commas.
    .replace(/\s*\|\s*/g, ", ")
    // A bare URL is unlistenable; name it instead of spelling it.
    .replace(/\bhttps?:\/\/\S+/gi, "the link")
    // Trace and log noise the agent sometimes echoes.
    .replace(/[ \t]+/g, " ")
    // A line break between two sentences is a pause; the engine only pauses on
    // punctuation, so give it some.
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    // The substitutions above readily produce ". ." and ", ,".
    .replace(/\s*\.(?:\s*\.)+/g, ".")
    .replace(/\s*,(?:\s*,)+/g, ",")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])(?=[^\s\d])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim()
    // A leading or trailing orphan from a stripped block.
    .replace(/^[.,;:\s]+/, "")
    .trim();

  if (!spoken) return hadBlock ? CODE_BLOCK_PLACEHOLDER : "";
  if (!hadBlock) return spoken;
  return /[.!?]$/.test(spoken)
    ? `${spoken} ${CODE_BLOCK_PLACEHOLDER}`
    : `${spoken}. ${CODE_BLOCK_PLACEHOLDER}`;
}
