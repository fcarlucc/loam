import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const MonitorIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
);
export const PowerIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v9" /><path d="M6.4 6.4a8 8 0 1 0 11.2 0" /></svg>
);
export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const MenuIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
// Two arrows pressing on a line: a conversation folded into its summary.
export const CompactIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M5 12h14" /></svg>
);
export const ChatIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12a8 8 0 0 1-11.6 7.1L3 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
);
export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: "currentColor", stroke: "none", ...p })}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
);
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" /></svg>
);
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
);
export const ChevronUpIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 15l6-6 6 6" /></svg>
);
export const DownloadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg>
);
export const CubeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
);
export const SlidersIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></svg>
);
export const XIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M15 6l-6 6 6 6" /></svg>
);
export const ChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>
);
export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
);
export const ColumnsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></svg>
);
export const ChartIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h16M7 16v-4M12 16V8M17 16v-7" /></svg>
);
export const BulbIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9.5 18h5M10.5 21h3" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" /></svg>
);
export const BellIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
);
export const BellOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8.6 5.6A6 6 0 0 1 18 11v5l1.5 2H9.5M6 11v5l-1.5 2h2.5" /><path d="M10 20a2 2 0 0 0 4 0" /><path d="M4 4l16 16" /></svg>
);
export const PaperclipIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7-7l8.8-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>
);
export const FileIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
);
export const BranchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
);
export const PlugIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5" /></svg>
);
