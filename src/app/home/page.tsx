import { redirect } from "next/navigation";

/** The courses map moved to `/` (2026-10-09); old links and bookmarks to /home land there. */
export default function HomeRedirect() {
  redirect("/");
}
