import { Button, Select, Slider, Stack, Switch, Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import {
  calculateOptimalFontSize,
  canvas2nv,
  hexStringToArrayBuffer,
  nv2imageData,
} from "./utils";
import { getFontGroups, loadFont } from "./fonts";

const sleep = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  const [text, setText] = useState("");
  const [bold, setBold] = useState(false);
  const [fontFamily, setFontFamily] = useState("monospace");

  // Dynamically load fonts when selected
  useEffect(() => {
    loadFont(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const debugCanvas = debugCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    })!;
    context.reset();

    // Disable antialiasing for sharper text rendering
    context.imageSmoothingEnabled = false;

    // Clear and rotate -90deg for label orientation
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Fill with white background for clean edges
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.transform(0, -1, 1, 0, 0, canvas.height);

    // Prepare multiline text and auto-fit font size
    const padding = 10;
    const availableWidth = canvas.height - padding * 2; // after rotation
    const availableHeight = canvas.width - padding * 2; // after rotation
    const lines = text.length ? text.split(/\r?\n/) : [""];
    const lineHeightRatio = 1.2;
    const lineSpacing = 0;

    // Calculate optimal font size
    const fontSize = calculateOptimalFontSize(
      context,
      lines,
      availableWidth,
      availableHeight,
      {
        minFont: 8,
        maxFont: 72,
        lineHeightRatio,
        lineSpacing,
        bold,
        fontFamily,
      },
    );

    context.font = `${bold ? "bold " : ""}${fontSize}px ${fontFamily}`;
    context.fillStyle = "black";
    context.textBaseline = "top";
    context.textAlign = "left";
    context.letterSpacing = "0px";
    // Try to force crisp text rendering
    (context as any).textRendering = "optimizeSpeed";
    (context as any).mozImageSmoothingEnabled = false;
    (context as any).webkitImageSmoothingEnabled = false;
    (context as any).msImageSmoothingEnabled = false;
    context.filter = "none";

    // Compute vertical starting offset to vertically center content
    const lineHeight = Math.ceil(fontSize * lineHeightRatio);
    const contentHeight =
      lines.length * lineHeight + Math.max(0, lines.length - 1) * lineSpacing;
    let y = padding + Math.max(0, (availableHeight - contentHeight) / 2);

    // Draw each line
    for (const line of lines) {
      context.fillText(line, padding, y);
      y += lineHeight + lineSpacing;
    }

    // Show the converted image on debug canvas
    if (debugCanvas) {
      const data = canvas2nv(canvas, 128);
      const debugContext = debugCanvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
      })!;
      debugContext.reset();
      debugContext.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

      const imageData = nv2imageData(data, canvas.width, canvas.height);
      debugContext.putImageData(imageData, 0, 0);
    }
  }, [text, bold, fontFamily]);

  const onClickPrint = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0xff00] }],
    });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(0xff00);
    const characteristics = await service.getCharacteristics();
    const writable = characteristics.find((c) => c.properties.write)!;

    const initBuffer = hexStringToArrayBuffer(
      [
        // INS_PRINT_DENSITY
        "1f1102",
        "02",
        // INS_SET_PAPER_TYPE
        "1f11",
        "0a",
        // PRINT_REPEAT
        "1f1121",
        "01",
        // INS_PRINTER_INIT
        "1b40",
        // INS_PRINT_PICTURE
        "1d763000",
      ].join(""),
    );
    await writable.writeValueWithoutResponse(initBuffer);

    const data = canvas2nv(canvas, 128);
    for (let i = 0; i < data.length; i += 100) {
      const chunk = data.slice(i, i + 100);
      await writable.writeValueWithoutResponse(chunk);
      await sleep(10);
    }
  };

  return (
    <Stack>
      <img width="400px" src="/d30.png" />
      <Textarea
        size="xl"
        placeholder="Type your label text (multi-line supported)"
        minRows={3}
        autosize
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <Switch
        label="Bold text"
        checked={bold}
        onChange={(event) => setBold(event.currentTarget.checked)}
      />
      <Select
        label="Font"
        value={fontFamily}
        onChange={(value) => setFontFamily(value || "monospace")}
        data={getFontGroups()}
        searchable
      />

      <Button color="green" onClick={onClickPrint}>
        Print!
      </Button>
      <canvas
        ref={canvasRef}
        // 12mm x 40mm label
        width={96}
        height={320}
        style={{
          // display: "none",
          border: "1px solid gray",
          position: "absolute",
          top: 10,
          left: 10,
          width: "100px",
          imageRendering: "pixelated", // Show pixels as-is without smoothing
          WebkitFontSmoothing: "none",
          fontSmooth: "never",
        }}
      />
      <canvas
        ref={debugCanvasRef}
        width={96}
        height={320}
        style={{
          border: "1px solid red",
          position: "absolute",
          top: 10,
          left: 120,
          width: "100px",
          imageRendering: "pixelated",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 115,
          left: 10,
          fontSize: "12px",
          color: "gray",
        }}
      >
        Original
      </div>
      <div
        style={{
          position: "absolute",
          top: 115,
          left: 120,
          fontSize: "12px",
          color: "red",
        }}
      >
        Converted (Debug)
      </div>
    </Stack>
  );
};
