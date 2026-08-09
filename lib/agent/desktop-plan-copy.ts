/**
 * Saying a desktop plan in words.
 *
 * The approval card is where a person decides whether to let an agent rearrange
 * their screen, and they get about two seconds to read it. Showing them the
 * arguments — `{"verb":"snap","handle":2,"preset":"right-half"}` — is showing
 * them nothing: handles are meaningless outside the model's head, and nobody
 * consents to JSON.
 *
 * So the plan is rendered as a short list of sentences naming apps and places.
 * Kept in its own module, away from the rendering, so the phrasing can be
 * tested — the wording *is* the safety feature here.
 */

export interface PlanStepInput {
  verb?: unknown;
  handle?: unknown;
  appId?: unknown;
  preset?: unknown;
  panel?: unknown;
  affordance?: unknown;
  value?: unknown;
  title?: unknown;
}

function placeName(preset: string): string {
  if (preset === "fill") return "full width";
  return `the ${preset.replace(/-/g, " ")}`;
}

function appName(appId: string): string {
  return appId
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function windowName(step: PlanStepInput): string {
  if (typeof step.title === "string" && step.title) return step.title;
  if (typeof step.appId === "string" && step.appId) return appName(step.appId);
  if (typeof step.handle === "number") return `window ${step.handle}`;
  return "a window";
}

export function describePlanStep(step: PlanStepInput): string {
  const verb = typeof step.verb === "string" ? step.verb : "";
  const name = windowName(step);

  switch (verb) {
    case "open_app":
      return `Open ${name}`;
    case "close_window":
      return `Close ${name}`;
    case "focus":
      return `Bring ${name} to the front`;
    case "minimize":
      return `Put ${name} away`;
    case "restore":
      return `Bring ${name} back`;
    case "snap":
      return typeof step.preset === "string"
        ? `Move ${name} to ${placeName(step.preset)}`
        : `Move ${name}`;
    case "set_geometry":
      return `Resize ${name}`;
    case "focus_panel":
      return typeof step.panel === "string"
        ? `Show ${step.panel} in ${name}`
        : `Switch what ${name} is showing`;
    case "set_affordance":
      return typeof step.affordance === "string"
        ? step.value
          ? `Set ${name}'s ${step.affordance} to "${step.value}"`
          : `Clear ${name}'s ${step.affordance}`
        : `Change a setting in ${name}`;
    case "pin_app":
      return `Keep ${name} in the dock`;
    case "unpin_app":
      return `Remove ${name} from the dock`;
    default:
      return `${verb || "Act"} on ${name}`;
  }
}

export interface DesktopPlanCopy {
  intent?: string;
  steps: string[];
}

export function describeDesktopPlan(input: unknown): DesktopPlanCopy {
  const payload = (input ?? {}) as { intent?: unknown; steps?: unknown };
  const steps = Array.isArray(payload.steps)
    ? (payload.steps as PlanStepInput[]).map(describePlanStep)
    : [];
  return {
    intent:
      typeof payload.intent === "string" && payload.intent.trim()
        ? payload.intent.trim()
        : undefined,
    steps,
  };
}

export function spokenApprovalPrompt(input: unknown): string {
  const plan = describeDesktopPlan(input);
  if (plan.steps.length === 0) {
    return plan.intent ? `${trimStop(plan.intent)}. Shall I?` : "Shall I?";
  }

  const [first, ...rest] = plan.steps.map(trimStop);
  const joined =
    rest.length === 0
      ? first
      : `${[first, ...rest.slice(0, -1).map(lowerFirst)].join(", ")}${
          rest.length > 1 ? "," : ""
        } and ${lowerFirst(rest[rest.length - 1])}`;

  return `${joined}. Shall I?`;
}

function trimStop(text: string): string {
  return text.trim().replace(/[.!?]+$/, "");
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
