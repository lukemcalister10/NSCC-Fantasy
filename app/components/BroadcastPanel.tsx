import type { ReactNode } from "react";

/**
 * The broadcast treatment — dark navy (#0d1b45) panel with #193889 chrome.
 * RESERVED, per the design brief, for the ladder header and score displays ONLY.
 * Do not use it for general chrome; the rest of the app is the clean-modern
 * white base.
 */
export function BroadcastPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`broadcast ${className}`.trim()}>{children}</div>;
}
