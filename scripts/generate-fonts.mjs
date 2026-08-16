// Regenerates src/google-fonts.json from the google-font-metadata dataset.
// Run with: npm run fonts:generate
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "node_modules/google-font-metadata/data/api-response.json";
const OUTPUT = "src/google-fonts.json";

const families = JSON.parse(readFileSync(SOURCE, "utf8"));

const fonts = families
  .filter((font) => font.subsets.includes("latin"))
  .map((font) => ({
    family: font.family,
    category: font.category,
    weights: [
      ...new Set(
        font.variants
          .filter((variant) => !variant.includes("italic"))
          .map((variant) => (variant === "regular" ? 400 : Number(variant))),
      ),
    ].sort((a, b) => a - b),
  }))
  .filter((font) => font.weights.length > 0)
  .sort((a, b) => a.family.localeCompare(b.family));

writeFileSync(OUTPUT, JSON.stringify(fonts));
console.log(`Wrote ${fonts.length} families to ${OUTPUT}`);
