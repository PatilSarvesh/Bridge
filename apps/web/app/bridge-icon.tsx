import type { ReactNode } from "react";

export type BridgeIconName =
  | "analytics"
  | "assumptions"
  | "audit"
  | "bell"
  | "bridge"
  | "chevron"
  | "copy"
  | "decisions"
  | "guide"
  | "inbox"
  | "organization"
  | "ownership"
  | "policy"
  | "questions"
  | "refresh"
  | "repositories"
  | "runs"
  | "settings"
  | "sparkle"
  | "specifications"
  | "support";

const iconPaths: Record<BridgeIconName, ReactNode> = {
  analytics: <><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/></>,
  assumptions: <><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.6 14.5A7 7 0 1 1 15.4 14.5c-.9.7-1.4 1.6-1.4 2.5h-4c0-.9-.5-1.8-1.4-2.5Z"/></>,
  audit: <><path d="M9 5h6"/><path d="M9 9h6"/><path d="M9 13h3"/><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="m15 17 1.5 1.5L20 15"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  bridge: <><path d="M4 18V8"/><path d="M20 18V8"/><path d="M4 11c4-3 12-3 16 0"/><path d="M4 15c4-3 12-3 16 0"/><path d="M2 20h20"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  decisions: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2L15.8 9"/></>,
  guide: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/><path d="M8 7h8"/><path d="M8 11h8"/></>,
  inbox: <><path d="M4 4h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
  organization: <><path d="M3 21h18"/><path d="M5 21V6l7-3 7 3v15"/><path d="M9 9h1"/><path d="M14 9h1"/><path d="M9 13h1"/><path d="M14 13h1"/><path d="M10 21v-4h4v4"/></>,
  ownership: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.7-4 2.5-6 5.5-6s4.8 2 5.5 6"/><circle cx="17" cy="9" r="2"/><path d="M16 14c2.7 0 4.2 1.7 4.5 5"/></>,
  policy: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>,
  questions: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.9-1.1 1.8"/><path d="M12 16h.01"/></>,
  refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.4 6.4L4 9"/><path d="M5.5 15A7 7 0 0 0 17.6 17.6L20 15"/></>,
  repositories: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="8" cy="19" r="2"/><path d="M6 7v5a7 7 0 0 0 7 7h3"/><path d="M18 8v3a4 4 0 0 1-4 4H8"/></>,
  runs: <><path d="M4 12h3l2-6 4 12 2-6h5"/><path d="M3 3v18h18"/></>,
  settings: <><path d="M4 6h6"/><path d="M14 6h6"/><circle cx="12" cy="6" r="2"/><path d="M4 12h10"/><path d="M18 12h2"/><circle cx="16" cy="12" r="2"/><path d="M4 18h2"/><path d="M10 18h10"/><circle cx="8" cy="18" r="2"/></>,
  sparkle: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/><path d="m5 14 .6 1.8 1.9.7-1.9.6L5 19l-.6-1.9-1.9-.6 1.9-.7z"/></>,
  specifications: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></>,
  support: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="m5.6 5.6 4.3 4.3"/><path d="m14.1 14.1 4.3 4.3"/><path d="m18.4 5.6-4.3 4.3"/><path d="m9.9 14.1-4.3 4.3"/></>,
};

export function BridgeIcon({
  name,
  size = 18,
  className,
}: Readonly<{ name: BridgeIconName; size?: number; className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}
