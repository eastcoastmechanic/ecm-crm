import { ICONS } from "./icons";

export type ServiceInfo = {
  slug: string;
  name: string;
  icon: string;
  shortDesc: string;
  longDesc: string;
  signs: string[];
  // Substrings matched against price_book_items.name (OR'd together) to find
  // a real, representative "starting around" price. These are deliberately
  // specific to genuine equipment/system line items (verified against the
  // live price book) rather than a blind cheapest-item-in-category query,
  // which would surface misleading numbers from per-foot materials and
  // accessory line items (e.g. an $8 line-set foot-price) instead of an
  // actual installed system cost.
  pricePatterns: string[];
  // A real photo from one of our own jobs, shown on the service detail page.
  // width/height are the real source dimensions so the display box matches
  // the photo's actual aspect ratio instead of cropping it to fit a fixed
  // shape. Optional — not every category has a clean, representative shot yet.
  image?: { src: string; alt: string; width: number; height: number };
};

export const SERVICES: ServiceInfo[] = [
  {
    slug: "heating",
    name: "Heating",
    icon: ICONS.flame,
    shortDesc:
      "Furnace and boiler installation, repair, and replacement, plus oil-to-gas conversions for homeowners looking to cut fuel costs. We diagnose no-heat calls fast and give you a straight answer on repair vs. replace.",
    longDesc:
      "Whether it's a furnace that won't fire up on the coldest morning of the year or a boiler that's overdue for replacement, we handle heating systems of every type. That includes oil-to-gas conversions for homeowners looking to cut fuel costs and simplify maintenance. We diagnose no-heat calls fast and give you a straight, honest answer on whether a repair makes sense or it's time to replace.",
    signs: [
      "Uneven heat between rooms, or some rooms that never get warm",
      "Heating bills climbing with no change in how you use the house",
      "A system more than 12–15 years old",
      "More than one repair call in the past year",
      "Banging, rattling, or a burning smell on startup",
    ],
    pricePatterns: [
      "Combi Boiler",
      "Condensing Boiler",
      "Cast Iron Gas Boiler",
      "Steam Boiler Replacement",
      "Oil-to-Gas Conversion",
    ],
    image: {
      src: "/site/work/boiler-room.jpg",
      alt: "A Lochinvar boiler and indirect water heater installed with copper piping in a customer's mechanical room",
      width: 1857,
      height: 1393,
    },
  },
  {
    slug: "cooling",
    name: "Cooling",
    icon: ICONS.snowflake,
    shortDesc:
      "Central AC installation, repair, and seasonal maintenance to keep your system running efficiently through the summer. We size systems correctly for your home instead of guessing.",
    longDesc:
      "A properly sized central AC system is the difference between a house that's actually comfortable in August and one that runs constantly without catching up. We install, repair, and maintain central air systems, and we size every system to your home's actual layout and load instead of guessing based on square footage alone.",
    signs: [
      "Weak airflow from vents, even with the system running",
      "The AC runs constantly but the house never quite cools down",
      "Warm air blowing from vents instead of cold",
      "Water pooling near the indoor unit",
      "A noticeable jump in summer electric bills",
    ],
    pricePatterns: ["Central Ducted Heat Pump"],
    image: {
      src: "/site/work/coastal-home-ac-generator.jpg",
      alt: "Four central air conditioning condensers installed on a coastal home, alongside a Kohler standby generator",
      width: 1857,
      height: 1393,
    },
  },
  {
    slug: "ductless-mini-splits",
    name: "Ductless / Mini-Splits",
    icon: ICONS.wind,
    shortDesc:
      "Single-zone and multi-zone ductless mini-split systems for additions, converted spaces, or whole-home comfort in houses without existing ductwork — heating and cooling from the same unit.",
    longDesc:
      "Ductless mini-splits are often the fastest way to get real heating and cooling into a room addition, a converted garage or basement, or a whole house that was never built with ductwork. A single outdoor unit can power one or several indoor heads, each with its own thermostat, so every zone gets exactly the temperature it needs.",
    signs: [
      "A room addition, sunroom, or converted space with no ductwork",
      "A garage, basement, or bonus room that's always too hot or too cold",
      "Wanting different temperatures in different rooms without redoing ductwork",
      "A home that relies on window units or space heaters in certain rooms",
    ],
    pricePatterns: [
      "Single-Zone Wall Mount",
      "Single-Zone Floor Mount",
      "Single-Zone Ceiling Cassette",
      "Single-Zone Concealed Duct",
      "2-Zone System",
      "3-Zone System",
      "4-Zone System",
      "5-Zone System",
      "Whole-Home Multi-Zone",
    ],
    image: {
      src: "/site/work/minisplits-new-construction.jpg",
      alt: "Four Mitsubishi ductless mini-split outdoor units installed on stands during new home construction",
      width: 1857,
      height: 2476,
    },
  },
  {
    slug: "ductwork",
    name: "Ductwork",
    icon: ICONS.duct,
    shortDesc:
      "New duct design and installation, plus repair of leaky or undersized ductwork that's causing uneven temperatures or high energy bills room to room.",
    longDesc:
      "Even a great furnace or AC can't do its job if the ductwork carrying the air is leaky, undersized, or poorly laid out. We design and install new duct systems and repair existing ones — sealing leaks, replacing damaged sections, and correcting layouts that are causing uneven temperatures from room to room.",
    signs: [
      "Some rooms are consistently hotter or colder than others",
      "Visible gaps, disconnected sections, or crushed duct runs",
      "Heavy dust buildup around vents and registers",
      "Whistling, rattling, or airflow noise when the system runs",
    ],
    pricePatterns: ["Aeroseal Duct Sealing"],
  },
  {
    slug: "heat-pumps",
    name: "Heat Pumps",
    icon: ICONS.thermometer,
    shortDesc:
      "High-efficiency heat pump installation for homeowners who want one system that handles both heating and cooling year-round, often paired with rebate and incentive programs.",
    longDesc:
      "A heat pump handles both heating and cooling from one high-efficiency system, which means one piece of equipment to maintain instead of two. It's a popular option for homeowners looking to move away from oil or propane, or to pair a comfort upgrade with available rebate and incentive programs.",
    signs: [
      "Paying to run separate heating and cooling systems",
      "Looking to reduce reliance on oil or propane deliveries",
      "Interested in efficiency rebates or incentive programs",
      "An aging central AC or furnace that's due for replacement anyway",
    ],
    pricePatterns: ["Central Ducted Heat Pump"],
    image: {
      src: "/site/work/heat-pump-air-handler.jpg",
      alt: "A Bosch heat pump air handler installed in a basement with a Honeywell zoning control panel",
      width: 1857,
      height: 2476,
    },
  },
  {
    slug: "air-quality",
    name: "Air Quality",
    icon: ICONS.filter,
    shortDesc:
      "Whole-home filtration, humidity control, and ventilation solutions so the air moving through your ductwork is actually clean — not just conditioned.",
    longDesc:
      "Heating and cooling the air is only half the job — what's actually in that air matters too. We install whole-home filtration, humidity control, and ventilation solutions that address dust, allergens, and stale air, so the air moving through your ductwork is genuinely clean, not just conditioned.",
    signs: [
      "Household allergies or respiratory irritation that seem worse indoors",
      "Noticeable dust buildup on surfaces and vents",
      "Air that feels too humid or too dry no matter the season",
      "Stale odors that linger despite regular cleaning",
    ],
    pricePatterns: ["Media Filter", "HEPA", "UV Air Purifier", "Humidifier", "Air Quality Monitor"],
    image: {
      src: "/site/work/furnace-air-quality.jpg",
      alt: "A furnace installation with a Trion whole-home air cleaner mounted alongside the return duct",
      width: 1857,
      height: 2476,
    },
  },
  {
    slug: "maintenance",
    name: "Maintenance",
    icon: ICONS.wrench,
    shortDesc:
      "Seasonal tune-ups that catch worn parts, refrigerant issues, and airflow problems before they turn into a breakdown on the coldest or hottest day of the year.",
    longDesc:
      "Most heating and cooling breakdowns don't happen out of nowhere — they show up as small warning signs a tune-up would have caught months earlier. Seasonal maintenance checks refrigerant levels, electrical connections, airflow, and wear-prone parts, so small issues get fixed on a schedule instead of turning into an emergency call.",
    signs: [
      "No professional tune-up in the past 12 months",
      "The system is short-cycling or running longer than it used to",
      "Your warranty requires documented annual service",
      "You're heading into the first cold snap or heat wave of the season",
    ],
    pricePatterns: ["Tune-Up", "Annual Inspection"],
    image: {
      src: "/site/work/technician-at-work.jpg",
      alt: "An East Coast Mechanical technician servicing outdoor condenser units",
      width: 1857,
      height: 1393,
    },
  },
];

export function getServiceBySlug(slug: string) {
  return SERVICES.find((s) => s.slug === slug);
}
