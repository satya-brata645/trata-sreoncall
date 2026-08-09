/**
 * Shell for the OS surfaces.
 *
 * Deliberately bare. The OS replaces product chrome rather than sitting inside
 * it — there is no nav rail, no tab bar and no page header, because the dock
 * and the menu bar are those things.
 *
 * The root layout leaves <body> unsized, so this owns viewport height. `h-dvh`
 * (not 100vh) so the desktop matches the visible area on mobile browsers.
 */
export default function OsLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh w-full overflow-hidden">{children}</div>;
}
