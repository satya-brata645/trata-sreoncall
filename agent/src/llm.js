// Thin OpenAI Chat Completions client with tool-calling support. No SDK —
// stays dependency-light, same spirit as starter/lgtm-client.js using bare
// fetch. docs/02 names OPENAI_API_KEY as this team's AI key.
//
// PLAN NOTE: this file is infrastructure (transport), not judgment. It never
// decides what the model should conclude — it just runs the tool-call loop
// until the model stops calling tools and returns a final answer.
const { OPENAI_API_KEY, OPENAI_MODEL_STRONG, OPENAI_MODEL_FAST } = require("./env");

const API_URL = "https://api.openai.com/v1/chat/completions";

// Converts our tool defs ({name, description, input_schema}) into OpenAI's
// function-calling shape. Kept as a pure mapping — no logic lives here.
function toOpenAiTools(tools) {
  return (tools || []).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: "object", properties: {} },
    },
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Transport-level retry on rate limits / transient server errors. This is
// resilience infrastructure, not judgment — it never changes what the model
// concludes, only whether a 429/5xx gets retried before giving up.
async function callOpenAi({ model, messages, tools, toolChoice, maxTokens = 1200, maxRetries = 8 }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env — required for any model call.");
  }
  const body = { model, messages, max_tokens: maxTokens };
  if (tools && tools.length) body.tools = toOpenAiTools(tools);
  if (toolChoice) body.tool_choice = toolChoice;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      throw new Error(`OpenAI API ${res.status}: ${text}`);
    }
    let waitMs = Math.min(30000, 2 ** attempt * 1000);
    const match = text.match(/try again in ([\d.]+)s/i);
    if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
    await sleep(waitMs);
  }
}

// Runs a full tool-use conversation: the model may call tools repeatedly
// (each call logged via onToolCall for auditability — §9 disclosure level 4)
// until it stops and produces a final text response. `toolImpls` maps tool
// name -> async function(input) -> result (JSON-serializable).
async function runAgentLoop({
  model,
  system,
  userMessage,
  tools,
  toolImpls,
  maxTokens = 1200,
  maxTurns = 10,
  onToolCall,
}) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];
  const callLog = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const startedAt = Date.now();
    const response = await callOpenAi({ model, messages, tools, maxTokens });
    const latencyMs = Date.now() - startedAt;
    callLog.push({ turn, request: { model, messages: [...messages] }, response, latency_ms: latencyMs });

    const choice = response.choices[0];
    const msg = choice.message;
    messages.push(msg);

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0 || choice.finish_reason !== "tool_calls") {
      return { finalText: msg.content || "", callLog, rawFinal: response };
    }

    for (const call of toolCalls) {
      let output;
      let input;
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch (err) {
        input = {};
        output = { error: `Could not parse tool arguments: ${err.message}` };
      }
      if (output === undefined) {
        try {
          const impl = toolImpls[call.function.name];
          if (!impl) throw new Error(`No implementation registered for tool "${call.function.name}"`);
          output = await impl(input);
        } catch (err) {
          output = { error: err.message };
        }
      }
      if (onToolCall) onToolCall({ name: call.function.name, input, output });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  throw new Error(`Agent loop exceeded maxTurns (${maxTurns}) without a final answer.`);
}

// One-shot structured call: forces the model to call exactly one tool and
// returns its parsed arguments. Used where the output is a small fixed
// shape (e.g. the attention hook's worth_a_look/next_check_in_seconds) and
// a full tool-use loop would be overkill.
async function callForStructuredOutput({ model, system, userMessage, tool, maxTokens = 1024 }) {
  const response = await callOpenAi({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
    tools: [tool],
    toolChoice: { type: "function", function: { name: tool.name } },
    maxTokens,
  });
  const call = response.choices[0].message.tool_calls?.[0];
  if (!call) throw new Error("Model did not return the forced tool call.");
  return JSON.parse(call.function.arguments);
}

module.exports = {
  callOpenAi,
  runAgentLoop,
  callForStructuredOutput,
  MODEL_STRONG: OPENAI_MODEL_STRONG,
  MODEL_FAST: OPENAI_MODEL_FAST,
};
