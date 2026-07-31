export function Icon({ path, className = "h-6 w-6" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const ICONS = {
  flame: "M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1.5-1-2-1-3.5 2 1 3 3.5 3 6.5a5 5 0 0 1-10 0c0-5 3-6 5-12z",
  snowflake: "M12 2v20M4.5 6l15 12M19.5 6l-15 12M2 12h20",
  wind: "M3 8h11a2.5 2.5 0 1 0-2-4M3 12h15a2.5 2.5 0 1 1-2 4M3 16h9",
  duct: "M3 8h18v8H3zM7 8v8M11 8v8M15 8v8M19 8v8",
  thermometer: "M10 13.5V4a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0zM12 8h1",
  filter: "M4 4h16l-6 8v6l-4 2v-8L4 4z",
  wrench: "M14.5 6.5a4 4 0 0 1-5.4 5.4L4 17l3 3 5.1-5.1a4 4 0 0 1 5.4-5.4l-3 3-2-2 3-3z",
};
