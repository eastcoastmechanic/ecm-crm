export type NavItem = { href: string; label: string; icon?: NavIcon };
export type NavGroup = { label: string; items: NavItem[] };
export type NavEntry = NavItem | NavGroup;
export type NavIcon =
  | "home"
  | "customers"
  | "jobs"
  | "docs"
  | "hub"
  | "catalog"
  | "more";

export function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

export const navEntries: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tech-hub", label: "Tech Hub" },
  {
    label: "Customers",
    items: [
      { href: "/customers", label: "Customers" },
      { href: "/properties", label: "Properties" },
      { href: "/equipment", label: "Equipment" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/leads", label: "Leads" },
      { href: "/documents", label: "Documents" },
      { href: "/payments", label: "Payments" },
      { href: "/catalog", label: "Catalog" },
      { href: "/price-book", label: "Price Book" },
      { href: "/mass-save", label: "MassSave" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/jobs", label: "Jobs" },
      { href: "/diagnostics", label: "Diagnostics" },
      { href: "/tasks", label: "Tasks" },
      { href: "/inventory", label: "Inventory" },
      { href: "/procurement", label: "Procurement" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/conversations", label: "Conversations" },
    ],
  },
];

export const TECH_VISIBLE_PATHS = ["/dashboard", "/tech-hub", "/jobs", "/catalog"];

export const STAFF_TABS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/customers", label: "Customers", icon: "customers" },
  { href: "/jobs", label: "Jobs", icon: "jobs" },
  { href: "/documents", label: "Docs", icon: "docs" },
];

export const TECH_TABS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/tech-hub", label: "Hub", icon: "hub" },
  { href: "/jobs", label: "Jobs", icon: "jobs" },
  { href: "/catalog", label: "Catalog", icon: "catalog" },
];

export function flattenNavItems(entries: NavEntry[] = navEntries): NavItem[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));
}

export function isNavActive(href: string, pathname: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageTitle(pathname: string) {
  if (pathname === "/dashboard") return "Home";
  if (pathname.startsWith("/account")) return "Account";
  const match = flattenNavItems()
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "ECM CRM";
}
