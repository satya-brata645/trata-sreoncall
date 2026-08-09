"use client";

/**
 * Running the desktop verbs in the browser.
 *
 * The bridge between a tool call arriving from the model and the controller
 * that owns the window manager. Deliberately a plain function rather than a
 * hook, so a future chat surface can call it from `onToolCall` without the
 * controller having to be threaded through every closure.
 *
 * Everything it returns is a **string**, not an object. The state the agent
 * reads is already a compact text rendering (`serializeSnapshot`) chosen
 * because it is read far more often than it is parsed, and wrapping it in JSON
 * would spend tokens on braces to say the same thing.
 */

import type { DesktopControllerValue } from "@/lib/os/DesktopControllerContext";
import { serializeSnapshot, type DesktopStep } from "@/lib/os/agentProtocol";

type SnapStep = Extract<DesktopStep, { verb: "snap" }>;

const DESKTOP_TOOLS = new Set([
  "read_desktop",
  "desktop_act",
  "begin_takeover",
  "restore_layout",
]);

export function isDesktopTool(toolName: string): boolean {
  return DESKTOP_TOOLS.has(toolName);
}

interface RawStep {
  verb?: unknown;
  handle?: unknown;
  appId?: unknown;
  preset?: unknown;
  rect?: unknown;
  panel?: unknown;
  affordance?: unknown;
  value?: unknown;
  title?: unknown;
}

function toStep(raw: RawStep): DesktopStep | string {
  const verb = raw.verb;
  if (typeof verb !== "string") return "Every step needs a `verb`.";

  const handle = typeof raw.handle === "number" ? raw.handle : undefined;
  const appId = typeof raw.appId === "string" ? raw.appId : undefined;

  switch (verb) {
    case "open_app":
      if (!appId) return "open_app needs an `appId` from the catalogue.";
      return {
        verb,
        appId,
        title: typeof raw.title === "string" ? raw.title : undefined,
      };

    case "pin_app":
    case "unpin_app":
      if (!appId) return `${verb} needs an \`appId\`.`;
      return { verb, appId };

    case "snap":
      if (handle === undefined) return "snap needs a window `handle`.";
      if (typeof raw.preset !== "string") return "snap needs a `preset`.";
      return { verb, handle, preset: raw.preset as SnapStep["preset"] };

    case "set_geometry": {
      if (handle === undefined) return "set_geometry needs a window `handle`.";
      const rect = raw.rect as Record<string, unknown> | undefined;
      if (
        !rect ||
        typeof rect.x !== "number" ||
        typeof rect.y !== "number" ||
        typeof rect.width !== "number" ||
        typeof rect.height !== "number"
      ) {
        return "set_geometry needs a `rect` with numeric x, y, width and height.";
      }
      return {
        verb,
        handle,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    }

    case "focus_panel":
      if (handle === undefined) return "focus_panel needs a window `handle`.";
      if (typeof raw.panel !== "string") {
        return "focus_panel needs a `panel` id from that window's own panels list.";
      }
      return {
        verb,
        handle,
        panel: raw.panel,
        value: typeof raw.value === "string" ? raw.value : undefined,
      };

    case "set_affordance":
      if (handle === undefined) return "set_affordance needs a window `handle`.";
      if (typeof raw.affordance !== "string") {
        return "set_affordance needs an `affordance` id from that window's own controls list.";
      }
      return {
        verb,
        handle,
        affordance: raw.affordance,
        value: typeof raw.value === "string" ? raw.value : "",
      };

    case "close_window":
    case "focus":
    case "minimize":
    case "restore":
      if (handle === undefined) return `${verb} needs a window \`handle\`.`;
      return { verb, handle };

    case "full_screen":
      return "Full screen is reserved for the user — use snap with the 'fill' preset instead.";

    default:
      return `\`${verb}\` is not a desktop verb.`;
  }
}

function renderBatchResult(
  status: string,
  stopReason: string | undefined,
  lines: string[],
  snapshotText: string,
): string {
  const header =
    status === "rejected"
      ? "PLAN REJECTED — nothing ran."
      : status === "stopped"
        ? `PLAN STOPPED (${stopReason ?? "unknown"}) — some steps did not run.`
        : "PLAN COMPLETED.";

  return [header, "", ...lines, "", snapshotText].join("\n");
}

export interface DesktopToolCallOptions {
  waitForNarration?: () => Promise<void>;
  recordRun?: (run: {
    steps: { verb: string; app_id?: string; detail?: string; status: string }[];
    ended: "completed" | "stopped";
    toolCallId?: string;
  }) => void;
  toolCallId?: string;
  approved?: boolean;
}

export async function handleDesktopToolCall(
  toolName: string,
  input: unknown,
  controller: DesktopControllerValue | null,
  summon?: (reason: string) => void,
  options: DesktopToolCallOptions = {},
): Promise<string | null> {
  if (!isDesktopTool(toolName)) return null;

  if (toolName === "begin_takeover") {
    const reason =
      typeof (input as { reason?: unknown })?.reason === "string"
        ? (input as { reason: string }).reason
        : "";
    if (!summon) {
      return "There is no desktop surface to bring up here.";
    }
    summon(reason);
    return "The surface is up — the user can see you are driving and can stop you. Say what you are doing as you do it.";
  }

  if (!controller) {
    return "There is no desktop in this context — you are in a plain chat surface, so you cannot open or arrange anything. Tell the user what to do rather than doing it.";
  }

  if (toolName === "read_desktop") {
    return controller.readDesktopText({ includeCatalog: true });
  }

  if (toolName === "restore_layout") {
    controller.restoreLayout();
    options.recordRun?.({
      steps: [
        {
          verb: "restore_layout",
          detail: "Restored the layout from before this run.",
          status: "ok",
        },
      ],
      ended: "completed",
      toolCallId: options.toolCallId,
    });
    return "Layout restored.";
  }

  if (toolName !== "desktop_act") {
    return "That desktop tool is not implemented here.";
  }

  const payload = (input ?? {}) as {
    epoch?: unknown;
    steps?: unknown;
  };
  if (typeof payload.epoch !== "string" || !payload.epoch.trim()) {
    return "desktop_act needs the `epoch` from your latest read_desktop.";
  }
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    return "desktop_act needs a non-empty `steps` array.";
  }

  const validated: DesktopStep[] = [];
  for (const raw of payload.steps as RawStep[]) {
    const step = toStep(raw);
    if (typeof step === "string") return step;
    validated.push(step);
  }

  await options.waitForNarration?.();

  const result = await controller.runBatch(
    { epoch: payload.epoch, steps: validated },
    { approved: options.approved ?? false },
  );

  const lines = result.outcomes.map((outcome, index) => {
    const detail = outcome.detail ? ` — ${outcome.detail}` : "";
    return `${index + 1}. ${outcome.step.verb}: ${outcome.status}${detail}`;
  });

  options.recordRun?.({
    steps: result.outcomes.map((outcome) => ({
      verb: outcome.step.verb,
      app_id: "appId" in outcome.step ? outcome.step.appId : undefined,
      detail: outcome.detail,
      status: outcome.status,
    })),
    ended: result.status === "completed" ? "completed" : "stopped",
    toolCallId: options.toolCallId,
  });

  return renderBatchResult(
    result.status,
    result.stopReason,
    lines,
    serializeSnapshot(result.snapshot, { includeCatalog: false }),
  );
}
