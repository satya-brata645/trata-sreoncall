"use client";

import { useId } from "react";

/**
 * App artwork — the icons the OS is recognised by.
 *
 * Every other symbol in this product is a monochrome stroke glyph, because
 * inside a window colour means *severity* and spending it on decoration is how
 * a red badge stops meaning "this is on fire". The dock, the Launchpad and the
 * store are the exception: there, colour is not decoration, it is *identity* —
 * the thing that lets someone hit the right tile without reading a label, the
 * same way nobody reads the word "Finder" before clicking it.
 *
 * So these are drawn objects, not glyphs: a full-bleed squircle, a two-stop
 * gradient, a highlight along the top edge, and a symbol that says what the app
 * actually does. They are the only coloured surfaces in the system, and they
 * live at the edges of it — a launcher, never a status.
 *
 * Everything is one 48×48 SVG with no external assets, so a tile is crisp at
 * 24px in a list row and at 96px in a full-screen Launchpad, and the whole set
 * costs nothing to load.
 */

/** Props every artwork accepts. `size` is the rendered edge in px. */
export interface AppArtworkProps {
  size?: number;
  className?: string;
  /** Announced by the caller instead, in every current use. */
  title?: string;
}

const DEFAULT_SIZE = 40;

/**
 * The tile every icon is drawn on.
 *
 * Gradient ids have to be unique per *instance*, not per component: two dock
 * tiles of the same app (pinned and running) would otherwise both point at one
 * `<defs>` entry, and whichever unmounts first takes the fill with it. `useId`
 * is stable across SSR and hydration, so the markup matches on both sides.
 *
 * The 22.9% radius is Apple's squircle ratio — 11/48. Any less and the tile
 * reads as a button; any more and it reads as a bubble.
 */
function Tile({
  size = DEFAULT_SIZE,
  className,
  title,
  from,
  to,
  children,
  /** Rim light strength. Dark tiles need more of it to separate from the dock. */
  rim = 0.16,
}: AppArtworkProps & {
  from: string;
  to: string;
  children: React.ReactNode;
  rim?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const bg = `bg-${uid}`;
  const sheen = `sh-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      // Icons scale by transform in the dock; shape-rendering left to the UA so
      // the squircle stays smooth while magnified.
      style={{ display: "block", flex: "none" }}
    >
      {title && <title>{title}</title>}
      <defs>
        {/* Top-left to bottom-right, not straight down: a diagonal is what makes
            a flat fill read as a lit object rather than a swatch. */}
        <linearGradient id={bg} x1="6" y1="0" x2="42" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={sheen} x1="24" y1="0" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.26" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="11" fill={`url(#${bg})`} />
      {/* Light from above, clipped to the tile — the one thing that keeps a
          gradient square from looking like a coloured div. */}
      <rect width="48" height="48" rx="11" fill={`url(#${sheen})`} />

      {children}

      {/* Rim. Inset by half a pixel so the stroke sits inside the shape and the
          corner does not fray against the dock's frost. */}
      <rect
        x="0.5"
        y="0.5"
        width="47"
        height="47"
        rx="10.5"
        stroke="#FFFFFF"
        strokeOpacity={rim}
      />
    </svg>
  );
}

/* ===========================================================================
   The OS's own apps
   ========================================================================= */

/**
 * Chat — where you talk to the agent.
 *
 * A bubble with a waveform in it rather than the usual three dots: this OS is
 * spoken as much as typed, and "…" means *someone else is typing*, which is
 * exactly the wrong promise for a surface you can interrupt out loud.
 */
export function ChatArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#9B7BFF" to="#5B34E0">
      <path
        d="M13 11h22a6 6 0 0 1 6 6v11a6 6 0 0 1-6 6H23.6l-7.2 5.4A1 1 0 0 1 14.8 38.6V34h-1.8a6 6 0 0 1-6-6V17a6 6 0 0 1 6-6Z"
        fill="#FFFFFF"
      />
      {/* Bars in the tile's own hue, not grey: the bubble is the object, the
          voice is the app, and a grey waveform reads as disabled. */}
      <g fill="#6B45E8">
        <rect x="15.5" y="20" width="3" height="5" rx="1.5" />
        <rect x="20.5" y="17" width="3" height="11" rx="1.5" />
        <rect x="25.5" y="19.5" width="3" height="6" rx="1.5" />
        <rect x="30.5" y="21.5" width="3" height="2" rx="1" />
      </g>
    </Tile>
  );
}

/**
 * Apps — the Launchpad.
 *
 * The grid *is* the icon, in the four tints the installed apps actually use, so
 * the launcher looks like what opening it shows. macOS puts a rocket here; a
 * rocket promises a launch, and nothing in this OS is launched — the apps are
 * already running and the grid is how you walk into one.
 */
export function LaunchpadArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#3A3A46" to="#17171E" rim={0.2}>
      <g>
        <rect x="10" y="10" width="12" height="12" rx="3.5" fill="#8B7BFF" />
        <rect x="26" y="10" width="12" height="12" rx="3.5" fill="#FF7A33" />
        <rect x="10" y="26" width="12" height="12" rx="3.5" fill="#4DA3E5" />
        <rect x="26" y="26" width="12" height="12" rx="3.5" fill="#4DC58A" />
      </g>
    </Tile>
  );
}

/**
 * App Store — what you could have.
 *
 * A bag with a spark in it. The spark is the honest part: nothing here ships
 * off a shelf, an app is *written* when it is asked for, and a plain shopping
 * bag would promise a download that never happens.
 */
export function AppStoreArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#4FA8FF" to="#1152C8">
      {/* A wide, shallow handle over a tapering body. A narrow arc on a square
          body is a padlock shackle, and in a product full of security tools
          that is the one thing this icon must not look like. */}
      <path
        d="M16.5 21.5v-2.8a7.5 7.5 0 0 1 15 0v2.8"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
      />
      <path
        d="M12.4 21.5h23.2a2.6 2.6 0 0 1 2.58 2.94l-1.42 11.1A3.4 3.4 0 0 1 33.4 38.5H14.6a3.4 3.4 0 0 1-3.36-2.96L9.82 24.44A2.6 2.6 0 0 1 12.4 21.5Z"
        fill="#FFFFFF"
      />
      {/* The fold across the top of a paper bag — one line, and the shape stops
          being ambiguous. */}
      <path d="M10.4 26h27.2" stroke="#1A6BDB" strokeOpacity="0.18" strokeWidth="1.6" />
      {/* Four-point spark: the mark this system uses everywhere for "the agent
          made this", so the store says *built on request* without a word. */}
      <path
        d="M24 26.2c.8 3.2 1.65 4.05 4.85 4.85-3.2.8-4.05 1.65-4.85 4.85-.8-3.2-1.65-4.05-4.85-4.85 3.2-.8 4.05-1.65 4.85-4.85Z"
        fill="#1A6BDB"
      />
    </Tile>
  );
}

/**
 * Files — every artefact the agent produced.
 *
 * A folder with the page already sticking out of it. A closed folder is a
 * filing cabinet; what this app actually holds is evidence someone is about to
 * read, and the page is what says so.
 */
export function FilesArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#54D8E8" to="#2472DE">
      {/* The page, tilted and sticking out of the top of the folder. Sat flat
          and mostly hidden it read as a briefcase handle — the tilt is what
          makes it a document someone has just filed. */}
      <g transform="rotate(-8 24 15)">
        <rect x="17" y="6.5" width="15" height="17" rx="2" fill="#FFFFFF" fillOpacity="0.82" />
        <g fill="#2472DE" fillOpacity="0.6">
          <rect x="20" y="10.5" width="9" height="1.7" rx="0.85" />
          <rect x="20" y="14" width="9" height="1.7" rx="0.85" />
          <rect x="20" y="17.5" width="6" height="1.7" rx="0.85" />
        </g>
      </g>
      {/* Two panels, not one rectangle: the folder is *open*, which is the whole
          claim Files makes — the evidence is already out. */}
      <path
        d="M8 17.5A3.5 3.5 0 0 1 11.5 14h7a2 2 0 0 1 1.6.8l1.9 2.5a2 2 0 0 0 1.6.8h12.9A3.5 3.5 0 0 1 40 21.5v13A3.5 3.5 0 0 1 36.5 38h-25A3.5 3.5 0 0 1 8 34.5v-17Z"
        fill="#FFFFFF"
        fillOpacity="0.72"
      />
      <path
        d="M9.6 24h28.8a2.5 2.5 0 0 1 2.45 3l-1.7 8.2A3.5 3.5 0 0 1 35.7 38H12.3a3.5 3.5 0 0 1-3.45-2.8l-1.7-8.2A2.5 2.5 0 0 1 9.6 24Z"
        fill="#FFFFFF"
      />
    </Tile>
  );
}

/**
 * Brain — what the agent knows and why.
 *
 * A graph, not a brain silhouette. What is inside this app is beliefs and the
 * links between them; an anatomical brain would claim a mind, which is both
 * untrue and unhelpful when the question is *where did that come from*.
 */
export function BrainArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#C07BFF" to="#6320C4">
      <g stroke="#FFFFFF" strokeOpacity="0.75" strokeWidth="1.7" strokeLinecap="round">
        <path d="M16.5 16.5 24 24M31.5 14.5 24 24M14 31.5 24 24M33 30.5 24 24M16.5 16.5 14 31.5M31.5 14.5 33 30.5" />
      </g>
      <g fill="#FFFFFF">
        <circle cx="24" cy="24" r="5" />
        <circle cx="16.5" cy="16.5" r="3.1" />
        <circle cx="31.5" cy="14.5" r="2.6" />
        <circle cx="14" cy="31.5" r="2.6" />
        <circle cx="33" cy="30.5" r="3.1" />
      </g>
      {/* The centre node reads as *current* — the belief being acted on. */}
      <circle cx="24" cy="24" r="2" fill="#7A2FD0" />
    </Tile>
  );
}

/* ===========================================================================
   The security apps
   ========================================================================= */

/**
 * SREonCall — the real mark.
 *
 * The wordmark is the product's own logo, traced from `SREonCall_Logo_Orange`
 * in the reference platform, on the near-black its own UI uses. It is the one
 * app in this workspace that exists outside the demo, and drawing it with a
 * generic pager glyph would have quietly demoted it to a fixture.
 *
 * The pulse under it is ours: the wordmark alone is a business card, and a dock
 * tile has to say what the app *does*.
 */
export function SreOnCallArtwork(props: AppArtworkProps) {
  const uid = useId().replace(/:/g, "");
  const grad = `sre-${uid}`;
  return (
    <Tile {...props} from="#141821" to="#07090D" rim={0.22}>
      <defs>
        <linearGradient id={grad} x1="8" y1="16" x2="40" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF6B2B" />
          <stop offset="1" stopColor="#FFB020" />
        </linearGradient>
      </defs>
      <g transform="translate(4.2 13.6) scale(0.2977)" fill={`url(#${grad})`}>
        <path d="M86.49 24.45c-.13 0-1.83-1.46-2.08-1.69-.2-.19-.48-.37-.43-.68 9.12-1.77 11.62-13.8 3.85-18.98C84.38.78 80.38.37 76.31.01L14.52 0C7.74.12.52 2.9.99 10.78c.21 3.57 1.56 4.72 3.97 6.88 0 0 3.07 1.55 3.8 1.53 7.76 1.29 16.33.07 24.23.52 1.65.38 2.39 1.03 2.17 2.79-.21 1.7-2.15 1.82-3.53 1.95l-25.17.02C4.5 27.06 2.29 29.48.4 32.1c-.8 1.11-.27.66.49.65 10.57-.1 22.23.68 32.63.02 5.93-.38 11.16-3.07 11.64-9.43.48-6.44-2.02-9.01-7.97-9.93-1.06-.16-2.07-.22-3.02-.17-5.89-.16-11.77-.16-17.65-.04l.02-.02c-2.47.13-4.22-1.11-4.27-1.15-.66-1.77.01-3.16 2.05-3.37h64.37c1.58.16 3.85 1.25 4.06 2.97.33 2.67-1.48 3.72-3.8 4.33-2.74.21-5.49.29-8.25.23l-6.77.11c-5.06-.15-10.53-.15-15.53 0l-.17.12c-.01 5.33 0 10.65.02 15.97v.38h.96c2.75.04 5.54.04 8.29 0h.74v-.35c.05-2.69.1-5.4.17-8.14.18-.16.53-.17.77-.18l14.95.08c.24.09.42.26.6.43 2.28 2.13 4.4 5.6 6.64 7.9l.6.35 45.4.01c.6-.09 3.63-4.76 4.47-5.38l2.17-3.04H86.5z" />
        <path d="M126.18 8.66c.09 0 .39-.26.5-.36 1.92-2.65 4.1-5.1 5.97-7.79.09-.26-.1-.4-.58-.42C119.56.05 107.1.07 94.69.18c-.15 6.43-.15 13.32 0 19.69 6.18.1 12.64.13 18.95.08l-.01.02h12.63l4.38-6.7c.16-.23.32-.46.46-.71H105.13c-.02 0-.26-.24-.26-.26V8.66h21.31z" />
      </g>
      <path
        d="M10 32h6.2l2.2-4.8 3.4 9.2 3-6.8 2 2.4H38"
        stroke="#FF7A33"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.9"
      />
    </Tile>
  );
}

/**
 * AuditIsEasy — evidence that is already collected.
 *
 * A clipboard with the tick already on it. The name is a claim about *when* the
 * work happens, so the icon shows the finished state rather than an empty form
 * waiting for someone to fill it in the week before the audit.
 */
export function AuditIsEasyArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#4ADE9B" to="#0A8F5C">
      <rect x="12" y="12" width="24" height="26" rx="4.5" fill="#FFFFFF" />
      <path
        d="M19 9.5h10a2.5 2.5 0 0 1 2.5 2.5v1.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V12A2.5 2.5 0 0 1 19 9.5Z"
        fill="#FFFFFF"
      />
      <rect x="17" y="12" width="14" height="4" rx="2" fill="#0A8F5C" fillOpacity="0.35" />
      <path
        d="m17.8 26.4 4.4 4.4 8.2-9.4"
        stroke="#0C9A63"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Tile>
  );
}

/**
 * dpflo — where personal data actually goes.
 *
 * A shield with a flow inside it, not a padlock: the app's claim is that it
 * knows the *route* data takes between stores, and a padlock would say the
 * opposite — that everything is shut.
 */
export function DpfloArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#9C86FF" to="#4B2BD4">
      <path
        d="M24 8.5 36 13v9.6c0 8.1-4.9 13.9-12 16.9-7.1-3-12-8.8-12-16.9V13l12-4.5Z"
        fill="#FFFFFF"
      />
      <g stroke="#5B34E0" strokeWidth="1.8" strokeLinecap="round">
        <path d="M18.6 20.4 24 26.6M29.4 20.4 24 26.6M18.6 20.4h10.8" />
      </g>
      <g fill="#5B34E0">
        <circle cx="18.6" cy="20.4" r="2.6" />
        <circle cx="29.4" cy="20.4" r="2.6" />
        <circle cx="24" cy="27.6" r="3" />
      </g>
    </Tile>
  );
}

/**
 * KodeShield — reachable code, not a CVE count.
 *
 * The angle brackets inside the shield are the whole distinction: this app
 * triages vulnerabilities against the source, so the symbol has to be code
 * behind cover rather than a generic padlock any scanner could claim.
 */
export function KodeShieldArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#6BC0FF" to="#1160C4">
      <path
        d="M24 8.5 36 13v9.6c0 8.1-4.9 13.9-12 16.9-7.1-3-12-8.8-12-16.9V13l12-4.5Z"
        fill="#FFFFFF"
      />
      <g stroke="#1668D2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="m21 19.5-4 4.5 4 4.5M27 19.5l4 4.5-4 4.5" />
      </g>
    </Tile>
  );
}

/**
 * NetMap — the topology as it is, against the topology as intended.
 *
 * A hub with its edges drawn, one of them dashed: the app is about *drift*, and
 * a clean star would say the network matches its diagram, which is the case it
 * was built for the absence of.
 */
export function NetMapArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#F7C24E" to="#C9761A">
      <g stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round">
        <path d="M24 24 15 15M24 24l9-9M24 24l-9 9" />
        <path d="M24 24l9 9" strokeDasharray="2.6 2.8" strokeOpacity="0.85" />
      </g>
      <g fill="#FFFFFF">
        <rect x="19.5" y="19.5" width="9" height="9" rx="2.6" />
        <circle cx="14.5" cy="14.5" r="3.2" />
        <circle cx="33.5" cy="14.5" r="3.2" />
        <circle cx="14.5" cy="33.5" r="3.2" />
      </g>
      <circle cx="33.5" cy="33.5" r="3.2" fill="#FFFFFF" fillOpacity="0.45" />
    </Tile>
  );
}

/**
 * IdentityLedger — standing access, written down.
 *
 * A key over ruled lines. The lines are the ledger half of the name: the app is
 * not an access request form, it is the record of who has held what, which is
 * what makes dormant credentials findable at all.
 */
export function IdentityLedgerArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#D79BFF" to="#6B21C8">
      {/* The ledger half of the name — the record the key is an entry in. */}
      <g fill="#FFFFFF" fillOpacity="0.5">
        <rect x="27" y="24" width="11" height="2.4" rx="1.2" />
        <rect x="27" y="29.5" width="11" height="2.4" rx="1.2" />
        <rect x="27" y="35" width="7" height="2.4" rx="1.2" />
      </g>
      <g fill="#FFFFFF">
        <circle cx="17.5" cy="16.5" r="6.6" />
        <rect x="15.9" y="21" width="3.2" height="16" rx="1.6" />
        <rect x="19.1" y="26.4" width="4.6" height="2.6" rx="1.3" />
        <rect x="19.1" y="31.4" width="3.4" height="2.6" rx="1.3" />
      </g>
      <circle cx="17.5" cy="16.5" r="2.7" fill="#7B2FD6" />
    </Tile>
  );
}

/**
 * VendorWatch — what a third party can still reach.
 *
 * An eye with the pupil drawn as a link. A plain eye is monitoring in the
 * abstract; the link is the specific thing being watched — the connection you
 * granted and never revisited.
 */
export function VendorWatchArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#FF9ED0" to="#B93476">
      <path
        d="M24 14c7.4 0 13.2 5.4 15.4 9.1a1.8 1.8 0 0 1 0 1.8C37.2 28.6 31.4 34 24 34S10.8 28.6 8.6 24.9a1.8 1.8 0 0 1 0-1.8C10.8 19.4 16.6 14 24 14Z"
        fill="#FFFFFF"
      />
      <circle cx="24" cy="24" r="6" fill="#B93476" />
      <circle cx="24" cy="24" r="2.4" fill="#FFFFFF" fillOpacity="0.9" />
      <circle cx="27.6" cy="20.6" r="1.5" fill="#FFFFFF" fillOpacity="0.55" />
    </Tile>
  );
}

/* ===========================================================================
   Fallbacks — apps this file was written before
   ========================================================================= */

/** Incident / paging, for an app whose name says so but that we do not know. */
export function PagerArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#FF8B6B" to="#C81E2A">
      <g stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M15.5 18.5a10 10 0 0 0 0 11M32.5 18.5a10 10 0 0 1 0 11" strokeOpacity="0.55" />
        <path d="M19.5 21.5a5 5 0 0 0 0 5M28.5 21.5a5 5 0 0 1 0 5" strokeOpacity="0.85" />
      </g>
      <circle cx="24" cy="24" r="4" fill="#FFFFFF" />
    </Tile>
  );
}

/** Cloud posture. */
export function CloudArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#7DC4F5" to="#2069C4">
      <path
        d="M18.5 33.5a7.5 7.5 0 0 1-.8-14.96 9 9 0 0 1 16.8 2.6 6.4 6.4 0 0 1-1.5 12.36H18.5Z"
        fill="#FFFFFF"
      />
    </Tile>
  );
}

/** Reports and digests. */
export function ReportArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#4A4A56" to="#1E1E26" rim={0.2}>
      <rect x="13" y="10" width="22" height="28" rx="4" fill="#FFFFFF" />
      <g fill="#3A3A46">
        <rect x="17.5" y="16" width="13" height="2.2" rx="1.1" />
        <rect x="17.5" y="21" width="13" height="2.2" rx="1.1" />
        <rect x="17.5" y="26" width="8" height="2.2" rx="1.1" />
      </g>
      <circle cx="30.5" cy="31.5" r="2.4" fill="#7A5AF8" />
    </Tile>
  );
}

/**
 * Anything else.
 *
 * Deliberately the dullest tile in the set, and still a tile: an app the OS has
 * never heard of is real, it is just unfamiliar, and a grey box next to five
 * drawn icons would read as broken rather than as new.
 */
export function GenericAppArtwork(props: AppArtworkProps) {
  return (
    <Tile {...props} from="#4A4A56" to="#22222B" rim={0.2}>
      <g fill="#FFFFFF">
        <rect x="11" y="11" width="12" height="12" rx="3.2" fillOpacity="0.9" />
        <rect x="25" y="11" width="12" height="12" rx="3.2" fillOpacity="0.55" />
        <rect x="11" y="25" width="12" height="12" rx="3.2" fillOpacity="0.55" />
        <rect x="25" y="25" width="12" height="12" rx="3.2" fillOpacity="0.32" />
      </g>
    </Tile>
  );
}
