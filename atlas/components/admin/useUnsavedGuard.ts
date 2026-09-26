"use client";
// Guards against losing unsaved edits. While `isDirty`:
//   - adds a native beforeunload warning (tab close / reload / external nav)
//   - guardedPush(href) confirms before an in-app router.push
//   - confirms before a same-origin <a> click (in-page <Link>s, sidebar nav)
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export function useUnsavedGuard(isDirty: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for the prompt to show in some browsers.
      e.returnValue = "";
    };
    // beforeunload never fires on client-side navigation, so also confirm on
    // same-origin <a> clicks (Next <Link>, sidebar nav). Capture phase on document
    // runs before React's root listener, so cancelling here stops Link's handler.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same-page hash jumps don't leave the form.
      const here = window.location;
      if (url.pathname === here.pathname && url.search === here.search && url.hash) return;
      if (!window.confirm("You have unsaved changes. Leave this page and discard them?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [isDirty]);

  const guardedPush = useCallback(
    (href: string) => {
      if (
        isDirty &&
        !window.confirm("You have unsaved changes. Leave this page and discard them?")
      ) {
        return;
      }
      router.push(href);
    },
    [isDirty, router]
  );

  return { guardedPush };
}
