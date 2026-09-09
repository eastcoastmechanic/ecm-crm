export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };
export type NavEntry = NavItem | NavGroup;

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
  { href: "/dashboard", label: "Home" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs", label: "Jobs" },
  { href: "/documents", label: "Docs" },
];

export const TECH_TABS: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/tech-hub", label: "Hub" },
  { href: "/jobs", label: "Jobs" },
  { href: "/catalog", label: "Catalog" },
];

export function flattenNavItems(entries: NavEntry[] = navEntries): NavItem[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));
}

export function isNavActive(href: string, pathname: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
