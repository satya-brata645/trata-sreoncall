import { Archive, Brain, LayoutGrid, MessageSquare, Store } from "lucide-react";

import {
  AppStoreArtwork,
  BrainArtwork,
  ChatArtwork,
  FilesArtwork,
  GenericAppArtwork,
  LaunchpadArtwork,
} from "@/components/os/icons/AppArtwork";

import { AppStoreApp } from "@/components/os/apps/AppStoreApp";
import { BrainApp } from "@/components/os/apps/BrainApp";
import { ChatApp } from "@/components/os/apps/ChatApp";
import { FilesApp } from "@/components/os/apps/FilesApp";
import { LaunchpadApp } from "@/components/os/apps/LaunchpadApp";
import { SecurityAppWindow } from "@/components/os/apps/SecurityAppWindow";
import type { OsAppDefinition, OsAppId } from "./types";

/**
 * The OS app registry — the single source of truth for what exists.
 *
 * The dock renders from this list, and the window layer resolves titles, icons
 * and components from it. Adding an app is one entry here plus its component;
 * neither the dock nor the window manager branches on app id.
 *
 * Order is dock order, top to bottom.
 */

/**
 * The registry id every security app shares.
 *
 * One entry serves all of them — which app is showing lives in the window's
 * `appId` param, not in a registry entry per app. Anything that needs to pick
 * these windows out of the window list matches on this.
 */
export const SECURITY_APP_ID = "security-app";

export const OS_APPS: readonly OsAppDefinition[] = [
  {
    id: "chat",
    title: "Chat",
    icon: MessageSquare,
    artwork: ChatArtwork,
    component: ChatApp,
    // Chat keeps its own thread list, so a second chat window would be
    // redundant — launching again focuses the existing one.
    singleton: true,
    // Written to answer *when would I bring this up*, not to label a tab —
    // these strings reach the model, so a description that merely restates the
    // label costs tokens and buys nothing.
    panels: [
      {
        id: "home",
        label: "Home",
        description:
          "The main conversation. Where you are talking now, and where a summoned turn lands.",
      },
      {
        id: "threads",
        label: "All threads",
        description:
          "Every conversation, to find one by name when the user refers to something discussed before.",
      },
      {
        id: "activity",
        label: "Activity",
        description:
          "What arrived while they were elsewhere, newest first, with the urgent ones coloured. Bring this up for 'what did I miss'.",
      },
      {
        id: "conversation",
        label: "A specific thread",
        description:
          "One conversation, named by a `chatId` param. Use it to take the user back to a thread rather than describing what was said in it.",
      },
    ],
  },
  {
    id: "apps",
    title: "Apps",
    icon: LayoutGrid,
    artwork: LaunchpadArtwork,
    component: LaunchpadApp,
    // One Launchpad is enough — it is a launcher, not a document.
    singleton: true,
    // No panels: Launchpad has one view. What it *has* is a control.
    affordances: [
      {
        id: "search",
        label: "Search",
        kind: "search",
        description:
          "Narrow the app list by name or capability. Use it to bring one app into view rather than describing where it is in the grid.",
      },
    ],
  },
  {
    id: "app-store",
    title: "App Store",
    icon: Store,
    artwork: AppStoreArtwork,
    component: AppStoreApp,
    panels: [
      {
        id: "discover",
        label: "Discover",
        description: "The whole app library, including what this workspace does not have.",
      },
      {
        id: "requests",
        label: "Your requests",
        description: "Apps already asked for, and the reference for each.",
      },
    ],
    // Sits next to Apps deliberately — "what you have" and "what you could
    // have" are the same errand, and a shop you have to go looking for sells
    // nothing.
    singleton: true,
  },
  {
    id: "files",
    title: "Files",
    icon: Archive,
    artwork: FilesArtwork,
    component: FilesApp,
    singleton: true,
    // One control for the whole address, not one per segment. Files is the only
    // app whose location is genuinely compound — root, app, build, date — and
    // separate controls could contradict each other, landing the window
    // somewhere no user ever navigated to.
    affordances: [
      {
        id: "location",
        label: "Folder",
        kind: "select",
        description:
          "Where Files is looking, as a path: /apps/<app>/build-3/outputs/<date>, or /chat/<conversation>. Use it to put someone in front of a file rather than telling them how to find it.",
      },
      {
        id: "search",
        label: "Search",
        kind: "search",
        description:
          "Find a file by name inside the current folder and everything under it.",
      },
    ],
  },
  {
    id: "brain",
    title: "Brain",
    icon: Brain,
    artwork: BrainArtwork,
    component: BrainApp,
    singleton: true,
    panels: [
      {
        id: "config",
        label: "Config",
        description: "What the agent has been told about this environment.",
      },
      {
        id: "memory",
        label: "Memory",
        description: "What it believes, where each belief came from, and when.",
      },
      {
        id: "cortex",
        label: "Cortex",
        description: "What it is working on, and what it plans to do next.",
      },
    ],
  },
  {
    id: SECURITY_APP_ID,
    title: "App",
    icon: LayoutGrid,
    artwork: GenericAppArtwork,
    component: SecurityAppWindow,
    // Opened from the Launchpad with an `appId` param, never launched cold, so
    // it gets no dock tile. Not a singleton: several apps can be open side by
    // side, and the manager dedupes per-`appId`.
    showInDock: false,
    panels: [
      {
        id: "overview",
        label: "Overview",
        description:
          "What this app found and what it is telling you — the answer, not the machinery.",
      },
      {
        id: "chat",
        label: "Build chat",
        description:
          "Dev Mode only. Shape the dashboard and its collection scope before promoting a build.",
      },
      {
        id: "history",
        label: "Build history",
        description:
          "Dev Mode only. Every version of this app and which one is live. Use it to inspect or roll back a build.",
      },
      {
        id: "activity",
        label: "App logs",
        description:
          "Dev Mode only. What the app did while it refreshed; use it when a result looks wrong and the question is why.",
      },
    ],
  },
] as const;

const APP_INDEX = new Map<OsAppId, OsAppDefinition>(OS_APPS.map((app) => [app.id, app]));

/** Look up a registered app. Returns undefined for unknown ids. */
export function getOsApp(appId: OsAppId): OsAppDefinition | undefined {
  return APP_INDEX.get(appId);
}
