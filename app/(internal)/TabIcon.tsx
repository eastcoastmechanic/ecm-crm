import type { NavIcon } from "./nav-config";

export default function TabIcon({ name, className }: { name: NavIcon; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: className ?? "h-5 w-5",
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M16.2 19a4.2 4.2 0 0 1 4.8-3.6" />
        </svg>
      );
    case "jobs":
      return (
        <svg {...common}>
          <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
          <rect x="4.5" y="7" width="15" height="13" rx="2" />
          <path d="M4.5 12h15" />
        </svg>
      );
    case "docs":
      return (
        <svg {...common}>
          <path d="M7 4.5h7l4.5 4.5V19.5A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 4.5z" />
          <path d="M14 4.5V9h4.5" />
          <path d="M9 13h6M9 16.5h4" />
        </svg>
      );
    case "hub":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
        </svg>
      );
    case "catalog":
      return (
        <svg {...common}>
          <path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H20v16H8.5A2.5 2.5 0 0 0 6 21.5z" />
          <path d="M6 5.5V21.5" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
