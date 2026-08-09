// Thin wrapper around OpenAI's tool-calling API. Both the cheap per-tick triage call and
// the deep multi-turn investigation loop share this one function — the only difference is
// which tools they're handed and which tool names count as "terminal" (loop-ending).

const OpenAI = require("openai");

let _client = null;
function client() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — check agent/.env or the repo root .env");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Runs a tool-use loop. `dispatch(name, args)` must return a JSON-serializable result (or
// throw — the error message is fed back to the model as the tool result so it can adapt).
// Stops as soon as any tool call in a turn has a name in `terminalToolNames`, or after
// `maxTurns` turns with no tool call at all (meaning the model had nothing to report).
// Token-per-minute limits are shared across the whole org, so a burst of investigations can
// transiently exceed them. These are recoverable — back off and retry rather than dropping a
// real investigation on the floor.
async function createWithRetry(params, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client().chat.completions.create(params);
    } catch (err) {
      lastErr = err;
      if (err?.status !== 429) throw err;
      const waitMs = 2000 * 2 ** i; // 2s, 4s, 8s, 16s
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

async function runToolLoop({ system, userMessage, tools, dispatch, terminalToolNames = [], maxTurns = 6, model }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];
  const toolCallLog = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    // On the final turn, stop offering read tools — the model must commit to one of the
    // terminal actions instead of gathering evidence forever and timing out undecided.
    const isLastTurn = turn === maxTurns - 1;
    const turnTools =
      isLastTurn && terminalToolNames.length
        ? tools.filter((t) => terminalToolNames.includes(t.function.name))
        : tools;
    if (isLastTurn && terminalToolNames.length) {
      messages.push({
        role: "user",
        content:
          "You are out of investigation turns. Commit now: call exactly one of the terminal actions using the evidence you already have. If the evidence is too thin to open an incident, call no_incident and say what was inconclusive.",
      });
    }

    const response = await createWithRetry({
      model: model || DEFAULT_MODEL,
      messages,
      tools: turnTools,
      // Restricting the tool list isn't enough on its own — the model will still reply with
      // prose and no tool call, ending the loop undecided. Requiring a call forces a verdict.
      ...(isLastTurn && terminalToolNames.length ? { tool_choice: "required" } : {}),
    });
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // The model often narrates the action it intends ("Open Incident with the following
      // details: ...") instead of calling the tool. Returning here would end the loop with no
      // decision recorded and the reasoning stranded in prose — so when a terminal action is
      // still owed, push back and let it try again rather than accepting the narration.
      if (terminalToolNames.length && turn < maxTurns - 1) {
        messages.push({
          role: "user",
          content:
            "You replied with prose but called no tool. Describing an action does not perform it — nothing was recorded. Either keep investigating with the read tools, or actually call one of the terminal actions now.",
        });
        continue;
      }
      return { terminal: null, content: msg.content, toolCallLog, messages };
    }

    let terminalCall = null;
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      let result;
      try {
        result = await dispatch(name, args);
      } catch (err) {
        result = { error: err.message };
      }
      toolCallLog.push({ name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      if (terminalToolNames.includes(name)) terminalCall = { name, args, result };
    }

    if (terminalCall) {
      return { terminal: terminalCall, content: msg.content, toolCallLog, messages };
    }
  }

  return { terminal: null, content: "(max turns reached without a terminal action)", toolCallLog, messages };
}

module.exports = { client, runToolLoop, DEFAULT_MODEL };
