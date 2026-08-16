// The printer lays down 8 dots per mm (203 dpi), so a 12 x 40mm label is
// exactly 96 x 320 dots. Drawing happens in "label space": x runs along the
// length, y across the width.
export const DOTS_PER_MM = 8;
export const MIN_FONT_SIZE = 10;
// Text can't be taller than the label is wide, so this is as big as the
// auto-fit will ever go.
export const MAX_FONT_SIZE = 12 * DOTS_PER_MM;

const MARGIN_MM = 1.25;

export type Label = {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  widthMm: number;
  lengthMm: number;
};

// Stock sizes, as printed on the cartridge. Anything else is set by hand.
export const LABEL_SIZES = [
  { widthMm: 12, lengthMm: 40 },
  { widthMm: 14, lengthMm: 60 },
];

// Cartridge widths the D30 takes, for custom sizes.
export const WIDTHS_MM = [12, 14, 15];

// The print head is 96 dots wide no matter how wide the tape is — the
// decompiled app calls this MAX_PRINT_WIDTH_DOT = 12 * 8 (D30Printer.java).
// Sending wider rows than this is out of spec and the printer drops the job.
export const MAX_PRINT_WIDTH_DOT = 12 * DOTS_PER_MM;

export const labelDots = ({ widthMm, lengthMm }: Label) => ({
  width: Math.min(widthMm * DOTS_PER_MM, MAX_PRINT_WIDTH_DOT),
  length: lengthMm * DOTS_PER_MM,
});

// True when the tape is wider than the head can reach.
export const isClamped = ({ widthMm }: Label) =>
  widthMm * DOTS_PER_MM > MAX_PRINT_WIDTH_DOT;

const measurer = document.createElement("canvas").getContext("2d")!;

const fontString = (label: Label, size: number) =>
  `${label.fontWeight} ${size}px "${label.fontFamily}", sans-serif`;

// The chosen size is a ceiling: text that would overrun the label shrinks to
// fit. Measurements are in label dots, so they don't depend on the resolution
// being drawn to.
export const fitFontSize = (label: Label) => {
  const { text, fontSize } = label;
  if (!text) {
    return fontSize;
  }

  const { width, length } = labelDots(label);
  const margin = MARGIN_MM * DOTS_PER_MM;

  measurer.font = fontString(label, fontSize);
  const metrics = measurer.measureText(text);
  const inkHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

  const fit = Math.min(
    1,
    (length - margin * 2) / metrics.width,
    (width - margin * 2) / inkHeight,
  );

  return Math.max(MIN_FONT_SIZE, Math.floor(fontSize * fit));
};

// A batch in auto mode uses one size for every label. The most constrained
// string sets that size; shorter strings deliberately keep the same type size
// rather than growing independently.
export const fitLabelsFontSize = (labels: Label[]) =>
  labels.length === 0
    ? MAX_FONT_SIZE
    : Math.min(...labels.map((label) => fitFontSize(label)));

// Where to put the baseline so the text looks centred across the tape.
//
// Centring the whole ink box is arithmetically correct but reads as too high:
// one descender in the string drags the box down, which pushes everything
// above it up. Type is centred on the band from the baseline to the top of the
// letters instead — descenders are allowed to hang, the way they do in print.
// The result is then nudged back inside the tape if a long tail would run off
// the edge.
const baselineFor = (metrics: TextMetrics, width: number) => {
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  const margin = MARGIN_MM * DOTS_PER_MM;

  // Both edges are clamped, so text that only just fits ends up ink-centred —
  // the only position where it fits at all.
  const highest = margin + ascent;
  const lowest = width - margin - descent;
  return Math.max(highest, Math.min(lowest, width / 2 + ascent / 2));
};

// Where the printer actually lays the image down, relative to where it should.
// Only the canvas that gets sent is nudged: the preview keeps showing the
// label as designed.
export type Offset = { along: number; across: number };

export const NO_OFFSET: Offset = { along: 0, across: 0 };

// `resolution` is a multiplier over the printer's own resolution: 1 for the
// canvas that gets printed, higher for a preview that shouldn't look jagged.
export const drawLabel = (
  canvas: HTMLCanvasElement,
  label: Label,
  resolution: number,
  offset: Offset = NO_OFFSET,
  fittedSize?: number,
) => {
  const { width, length } = labelDots(label);

  canvas.width = width * resolution;
  canvas.height = length * resolution;

  const context = canvas.getContext("2d")!;
  context.reset();
  context.scale(resolution, resolution);
  // rotate -90deg, putting us in label space
  context.transform(0, -1, 1, 0, 0, length);
  context.translate(offset.along, offset.across);

  const size = fittedSize ?? fitFontSize(label);
  context.font = fontString(label, size);
  // Aligning "center" centres the advance width, which includes the side
  // bearings — a letter with a wide bearing on one side then sits off to one
  // side. Placing from the left and centring the measured ink instead lands
  // the marks themselves in the middle.
  context.textAlign = "left";

  const metrics = context.measureText(label.text);
  const inkLeft = metrics.actualBoundingBoxLeft;
  const inkRight = metrics.actualBoundingBoxRight;

  context.fillText(
    label.text,
    length / 2 - (inkRight - inkLeft) / 2,
    baselineFor(metrics, width),
  );

  return size;
};
