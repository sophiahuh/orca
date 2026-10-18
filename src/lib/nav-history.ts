"use client";

/**
 * The pages visited inside the app in this tab, so a back button can go to the page the student
 * actually came from (`history.back()`), and only falls back to a fixed page when there's no previous
 * app page (opened directly, after a reload, or arriving from outside). Kept in memory: a reload
 * starts over, which is the case the fallback covers.
 *
 * Each URL change is read as one of: going back (the URL is the previous one), a push (the browser's
 * history grew), or a replace (it didn't). A browser forward or a push after going back can look
 * like a replace; then the stack is shorter than the real history, so the button falls back to its
 * fixed page rather than leaving the app.
 */
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const stack: string[] = [];
let lastLength = 0;

function visit(url: string) {
  const length = window.history.length;
  if (stack.length >= 2 && stack[stack.length - 2] === url) stack.pop();
  else if (stack.length === 0 || length > lastLength) stack.push(url);
  else if (stack[stack.length - 1] !== url) stack[stack.length - 1] = url;
  lastLength = length;
}

/** Whether there's an earlier page of this app to go back to. */
export function canGoBack(): boolean {
  return stack.length > 1;
}

/** Go to the previous app page, or (with none) replace this one with `fallback`. For "leave this screen" actions. */
export function goBack(router: { back: () => void; replace: (href: string) => void }, fallback: string): void {
  if (canGoBack()) router.back();
  else router.replace(fallback);
}

/** Track every page the app shows (mounted once, in the providers). */
export function useNavHistory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    visit(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);
}
