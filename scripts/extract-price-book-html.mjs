// One-off: extract the embedded catalog arrays from
// ~/Downloads/ECM-Price-Book.html into a plain JSON file the import route
// can read. Runs the file's own DATA block in a VM sandbox rather than
// regex-parsing it, so quoting/escaping in descriptions (e.g. embedded
// inches marks) can't trip up extraction.
import { readFileSync, writeFileSync } from "fs";
import vm from "vm";

const html = readFileSync("C:/Users/JoshC/Downloads/ECM-Price-Book.html", "utf8");

const start = html.indexOf("const daikinSingleZone");
const end = html.indexOf("const ALL = [].concat(");
if (start === -1 || end === -1) throw new Error("Couldn't find the DATA block markers");

const dataScript = html.slice(start, end);

const arrayNames = [
  "daikinSingleZone",
  "daikinMultiOutdoor",
  "daikinMultiIndoor",
  "daikinControls",
  "goodmanAC",
  "goodmanHP",
  "goodmanFurnaces",
  "goodmanAH",
  "goodmanCoils",
  "goodmanAccessories",
  "parts",
];

// `const`/`let` declared by vm.runInContext don't attach to the sandbox
// object (only `var` does) -- return them directly as the script's value
// instead of reading them back off the context.
const collected = vm.runInNewContext(`${dataScript}\n({${arrayNames.join(",")}})`);

const all = [];
for (const name of arrayNames) {
  const arr = collected[name];
  if (!Array.isArray(arr)) throw new Error(`${name} did not evaluate to an array`);
  all.push(...arr);
}

writeFileSync("scripts/data/ecm-price-book-2026-08.json", JSON.stringify(all, null, 2));
console.log(`Extracted ${all.length} items to scripts/data/ecm-price-book-2026-08.json`);
