export const canvas2nv = (canvas: HTMLCanvasElement) => {
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

  const byteArray = [];

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;

  for (let y = 0; y < height; y++) {
    for (let byteIndex = 0; byteIndex < byteWidth; byteIndex++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteIndex * 8 + bit;
        if (x < width) {
          // Calculate the index in the imageData array
          const index = (y * width + x) * 4; // Each pixel is 4 elements (RGBA)
          const [red, green, blue] = adjustColor(
            imageData.slice(index, index + 4),
          );
          const grayscale = (red + green + blue) / 3;
          // Thresholding to create a monochrome image
          const bitValue = grayscale < 128 ? 1 : 0;
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
  // Assume a white background
  const backgroundRgb = [255, 255, 255];

  const adjustedRgb = [];

  const alpha = rgba[3];

  for (let i = 0; i < 3; i++) {
    // Loop over R, G, and B
    // Calculate the new color component, simulating transparency against a white background
    adjustedRgb[i] = Math.round(
      (rgba[i] * alpha) / 255 + backgroundRgb[i] * (1 - alpha / 255),
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
