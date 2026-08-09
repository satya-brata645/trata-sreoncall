import { redirect } from "next/navigation";

/**
 * There is one surface. The desktop is where you land, unless the agent has
 * something to say — in which case it raises Chat over the desktop itself,
 * rather than routing you somewhere else.
 */
export default function Home() {
  redirect("/desktop");
}
