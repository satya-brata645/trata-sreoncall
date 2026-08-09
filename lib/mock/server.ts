/**
 * The fixture backend.
 *
 * `fetchBackend` routes here whenever `NEXT_PUBLIC_API_BASE_URL` is unset, so
 * the whole app runs on one switch: set the variable and every resource goes to
 * the real service; leave it unset and the same call signatures resolve from
 * `fixtures.ts`. Resources can also be moved across one at a time by deleting
 * their case below once the endpoint exists.
 *
 * The small delay is deliberate. Instant resolution hides every loading state,
 * and a skeleton nobody ever sees is a skeleton nobody notices is broken.
 */

import {
  ALL_APPS,
  BUILDS,
  CONVERSATION_FILES,
  OWNED_APPS,
  WAKE_UPS,
  WAKE_UP_FILES,
} from "./fixtures";

const LATENCY_MS = 140;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/** `/builds/{appId}` → the app's promoted logic, newest first. */
function builds(appId: string) {
  const list = BUILDS[appId] ?? [];
  const latest = list.length ? list[0].number : null;
  return { app_id: appId, builds: list, latest_build: latest, current_build: latest };
}

export function handle<T>(path: string, options: { body?: unknown } = {}): Promise<T> {
  const [route, rawQuery] = path.split("?");
  const query = new URLSearchParams(rawQuery ?? "");
  const segments = route.split("/").filter(Boolean);

  const respond = (value: unknown) => delay(value as T);

  if (route === "/projects") {
    const all = query.get("all") === "true";
    return respond({ projects: all ? ALL_APPS : OWNED_APPS, success: true });
  }

  if (route === "/app-store/catalog") {
    return respond({ branch: "main", apps: ALL_APPS });
  }

  if (route === "/app-store/requests") {
    return respond([]);
  }

  if (segments[0] === "builds" && segments[1]) {
    return respond(builds(decodeURIComponent(segments[1])));
  }

  if (route === "/conversations/files") {
    return respond({
      conversations: CONVERSATION_FILES,
      total_files: CONVERSATION_FILES.reduce((n, c) => n + c.files.length, 0),
    });
  }

  if (route === "/project/sessions") {
    // One page holds the whole fixture workspace, so paging terminates on the
    // first request rather than looping the caller's "keep paging" effect.
    return respond({ sessions: WAKE_UPS, total: WAKE_UPS.length, success: true });
  }

  if (segments[0] === "project" && segments[1] === "files" && segments[2]) {
    const id = decodeURIComponent(segments[2]);
    return respond({ files: WAKE_UP_FILES[id] ?? [], success: true });
  }

  return Promise.reject(
    new Error(`No fixture for "${route}". Add a case in lib/mock/server.ts or point NEXT_PUBLIC_API_BASE_URL at a backend.`),
  );
}
