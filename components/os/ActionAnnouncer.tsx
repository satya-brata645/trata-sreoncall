"use client";

/**
 * The desktop's live region for agent actions (`UX-21`, `NFR-11`, `A-16`).
 *
 * Visually hidden and permanently mounted. Both matter:
 *
 *  - **Hidden**, because sighted users already see the window move and read
 *    the narration in the command bar. This is the same information for people
 *    who cannot see it, not a second copy for everyone.
 *  - **Permanently mounted**, because a live region has to exist *before* the
 *    text lands in it. Screen readers watch a region for changes; one that
 *    appears at the same moment as its first message is frequently not
 *    announced at all, which is the classic way this feature ships looking
 *    correct and doing nothing.
 *
 * `polite`, not `assertive`: these arrive several per batch, and interrupting
 * the reader mid-sentence for every window move would be worse than the
 * silence it replaces. The one place `assertive` is right is the approval card
 * — a request for consent *should* interrupt — and that is set there.
 */

import { useAnnouncement } from "@/lib/os/announcements";

export function ActionAnnouncer() {
  const { message, seq } = useAnnouncement();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {/*
        Keyed on the sequence number, not the text. Two identical actions in a
        row produce the same string, and a live region whose content has not
        changed is not re-read — so the second move would be silent. Remounting
        the node forces the announcement.
      */}
      <span key={seq}>{message}</span>
    </div>
  );
}
