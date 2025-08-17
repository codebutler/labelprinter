export const canvas2nv = (
  canvas: HTMLCanvasElement,
  threshold: number = 128,
) => {
  const context = canvas.getContext("2d")!;

  const width = canvas.width;
  const height = canvas.height;
  const byteWidth = Math.ceil(width / 8);

  // NV image header includes the width in bytes and the height, both as 16-bit integers
  const header = [
    byteWidth & 0xff, // Width low byte
    (byteWidth >> 8) & 0xff, // Width high byte
    height & 0xff, // Height low byte
    (height >> 8) & 0xff, // Height high byte
  ];

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;

  // Convert directly to monochrome with simple threshold
  const byteArray = [];
  for (let y = 0; y < height; y++) {
    for (let byteIndex = 0; byteIndex < byteWidth; byteIndex++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteIndex * 8 + bit;
        if (x < width) {
          const index = (y * width + x) * 4;
          const [red, green, blue] = adjustColor(
            imageData.slice(index, index + 4),
          );
          // Use proper luminance calculation
          const grayscale = 0.299 * red + 0.587 * green + 0.114 * blue;
          // Simple threshold - adjust if needed (lower = more black ink)
          const bitValue = grayscale < threshold ? 1 : 0;
          // Set bit in the byte
          byte |= bitValue << (7 - bit);
        }
      }
      byteArray.push(byte);
    }
  }

  return Uint8Array.from([...header, ...byteArray]);
};

const adjustColor = (rgba: Uint8ClampedArray) => {
  // Assume a white background for alpha compositing
  const backgroundRgb = [255, 255, 255];

  const adjustedRgb = [];

  const alpha = rgba[3] / 255; // Normalize alpha to 0-1

  for (let i = 0; i < 3; i++) {
    // Loop over R, G, and B
    // Proper alpha compositing formula
    adjustedRgb[i] = Math.round(
      rgba[i] * alpha + backgroundRgb[i] * (1 - alpha),
    );
  }

  return adjustedRgb; // Returns the adjusted RGB values as an array
};

export const hexStringToArrayBuffer = (hexString: string) => {
  const bufferLength = hexString.length / 2;
  const buffer = new ArrayBuffer(bufferLength);
  const bufferView = new Uint8Array(buffer);
  for (let i = 0; i < bufferLength; i++) {
    const byte = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
    bufferView[i] = byte;
  }
  return buffer;
};

// Parse NV format data back to ImageData for debug display
export const nv2imageData = (
  data: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
): ImageData => {
  // Parse the NV format header
  const byteWidth = data[0] | (data[1] << 8);
  const height = data[2] | (data[3] << 8);
  const imageDataArray = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);

  // Convert printer data back to pixels
  let dataIndex = 4; // Skip header
  for (let y = 0; y < height; y++) {
    for (let byteIndex = 0; byteIndex < byteWidth; byteIndex++) {
      const byte = data[dataIndex++];
      for (let bit = 0; bit < 8; bit++) {
        const x = byteIndex * 8 + bit;
        if (x < canvasWidth) {
          const pixelIndex = (y * canvasWidth + x) * 4;
          const isBlack = (byte >> (7 - bit)) & 1;
          const color = isBlack ? 0 : 255;
          imageDataArray[pixelIndex] = color; // R
          imageDataArray[pixelIndex + 1] = color; // G
          imageDataArray[pixelIndex + 2] = color; // B
          imageDataArray[pixelIndex + 3] = 255; // A
        }
      }
    }
  }

  return new ImageData(imageDataArray, canvasWidth, canvasHeight);
};

// Calculate optimal font size for text to fit in given dimensions
export const calculateOptimalFontSize = (
  context: CanvasRenderingContext2D,
  lines: string[],
  availableWidth: number,
  availableHeight: number,
  options: {
    minFont?: number;
    maxFont?: number;
    lineHeightRatio?: number;
    lineSpacing?: number;
    bold?: boolean;
    fontFamily?: string;
  } = {},
): number => {
  const {
    minFont = 8,
    maxFont = 72,
    lineHeightRatio = 1.2,
    lineSpacing = 0,
    bold = false,
    fontFamily = "sans-serif",
  } = options;

  const measureMaxWidth = (size: number) => {
    context.font = `${bold ? "bold " : ""}${size}px ${fontFamily}`;
    let max = 0;
    for (const line of lines) {
      const w = context.measureText(line).width;
      if (w > max) max = w;
    }
    return max;
  };

  let fontSize = maxFont;
  while (fontSize > minFont) {
    const maxLineWidth = measureMaxWidth(fontSize);
    const lineHeight = Math.ceil(fontSize * lineHeightRatio);
    const totalHeight =
      lines.length * lineHeight + Math.max(0, lines.length - 1) * lineSpacing;

    if (maxLineWidth <= availableWidth && totalHeight <= availableHeight) {
      break;
    }
    fontSize -= 1;
  }

  return fontSize;
};
