/**
 * The backend seam.
 *
 * Every resource module goes through this one function. With
 * `NEXT_PUBLIC_API_BASE_URL` unset — the default — it resolves from the fixture
 * backend in `lib/mock/server.ts`; set it and the identical calls go to the
 * real service. Nothing else in the app is allowed to call `fetch` directly,
 * which is what makes landing the backend a per-endpoint change rather than a
 * per-component one.
 */

import { handle as handleFixture } from "@/lib/mock/server";

export interface FetchOptions extends Omit<RequestInit, "body"> {
  /** Bearer token for the authenticated caller. */
  token?: string | null;
  /** Workspace scope; sent as `X-Org-Slug`. */
  orgSlug?: string | null;
  /** Extra scope some endpoints read, e.g. internal-file visibility. */
  showInternalFiles?: string;
  body?: unknown;
}

export type AuthParams = Pick<FetchOptions, "token" | "orgSlug">;

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** True while the app is running on fixtures. */
export const USING_FIXTURES = !API_BASE_URL;

export async function fetchBackend<T>(path: string, options: FetchOptions = {}): Promise<T> {
  if (USING_FIXTURES) return handleFixture<T>(path, { body: options.body });

  const { token, orgSlug, body, headers, ...rest } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgSlug ? { "X-Org-Slug": orgSlug } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
