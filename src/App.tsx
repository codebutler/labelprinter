import { Button, Input, Stack } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { canvas2nv, hexStringToArrayBuffer } from "./utils";

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [text, setText] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: false })!;
    context.reset();

    // rotate -90deg
    context.transform(0, -1, 1, 0, 0, canvas.height);

    context.font = "46px sans-serif";
    context.fillText(text, 10, 60);
  }, [text]);

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

    // initialize printer
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
      ].join(),
    );

    await writable.writeValueWithoutResponse(initBuffer);

    const data = canvas2nv(canvas);
    for (let i = 0; i < data.length; i += 100) {
      const chunk = data.slice(i, i + 100);
      await writable.writeValueWithoutResponse(chunk);
    }
  };

  return (
    <Stack>
      <Input
        placeholder="Type something"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <canvas
        ref={canvasRef}
        // 12mm x 40mm label
        width={96}
        height={320}
        style={{
          display: "none",
        }}
      />
      <Button color="green" onClick={onClickPrint}>
        Print!
      </Button>
    </Stack>
  );
};
