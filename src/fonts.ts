import catalog from "./google-fonts.json";

export type Font = {
  family: string;
  category: string;
  weights: number[];
};

// Every latin Google Font, with its real weights. Generated from the
// google-font-metadata dataset by scripts/generate-fonts.mjs.
export const FONTS: Font[] = catalog;

const byFamily = new Map(FONTS.map((font) => [font.family, font]));

export const FONT_FAMILIES = FONTS.map((font) => font.family).sort((a, b) =>
  a.localeCompare(b),
);

// Anton: condensed and heavy, which is what survives thermal dot gain on a
// 12mm label.
export const DEFAULT_FONT = "Anton";

export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extralight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extrabold",
  900: "Black",
};

export const findFont = (family: string) =>
  byFamily.get(family) ?? byFamily.get(DEFAULT_FONT)!;

// Keeps a weight valid when switching families: falls back to the closest
// weight the new family actually has.
export const nearestWeight = (family: string, weight: number) => {
  const { weights } = findFont(family);
  return weights.reduce((best, candidate) =>
    Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
  );
};

// Bold where the family has it; Anton only ships one weight.
export const DEFAULT_WEIGHT = nearestWeight(DEFAULT_FONT, 700);

const requested = new Set<string>();

// Injecting the stylesheet is enough for anything already rendered in that
// family to restyle itself once the face arrives.
export const requestFont = (family: string) => {
  if (requested.has(family)) {
    return;
  }
  requested.add(family);

  const font = findFont(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    font.family,
  ).replace(/%20/g, "+")}:wght@${font.weights.join(";")}&display=swap`;
  document.head.appendChild(link);
};

// Canvas silently falls back to a default face when the requested font hasn't
// loaded, so both measuring and drawing must wait on this.
export const loadFont = async (
  family: string,
  weight: number,
  size: number,
) => {
  requestFont(family);

  // document.fonts.load only knows about @font-face rules that have already
  // arrived, so asking too early resolves instantly with the fallback still in
  // place. Keep asking until the face is really there.
  const spec = `${weight} ${size}px "${family}"`;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await document.fonts.load(spec);
    if (document.fonts.check(spec)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
