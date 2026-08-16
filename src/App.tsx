import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStored, useViewportWidth } from "@/hooks";
import {
  DEFAULT_FONT,
  DEFAULT_WEIGHT,
  FONT_FAMILIES,
  findFont,
  loadFont,
  nearestWeight,
  requestFont,
  WEIGHT_NAMES,
} from "@/fonts";
import {
  drawLabel,
  isClamped,
  labelDots,
  LABEL_SIZES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  WIDTHS_MM,
} from "@/label";
import {
  bluetoothAvailable,
  connectPrinter,
  describeError,
  isCancellation,
  pollPrinter,
  printCanvas,
  queryPrinter,
  reconnectPrinter,
  type LogEntry,
  type PrintStage,
  type Session,
} from "@/print";
import type { PrinterStatus } from "@/protocol";

const CUSTOM_SIZE = "custom";
const SIZE_MODES = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Fixed" },
];
const MAX_PREVIEW_SCALE = 4;
const PANEL_WIDTH = 1040;

// A name rendered in its own face. With every family in the list at once, the
// stylesheet is only fetched once the option is actually scrolled into view.
const FontName: React.FC<{ family: string }> = ({ family }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        requestFont(family);
        setShown(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [family]);

  return (
    <span
      ref={ref}
      style={shown ? { fontFamily: `"${family}", sans-serif` } : undefined}
    >
      {family}
    </span>
  );
};

const statusText = (status: PrintStage) => {
  switch (status.stage) {
    case "idle":
      return "Ready";
    case "selecting":
      return "Choose your printer";
    case "connecting":
      return "Connecting";
    case "sending":
      return `Sending ${Math.round(status.progress * 100)}%`;
    case "waiting":
      return "Waiting for the printer";
    case "done":
      // The printer confirms with a "print complete" notification; without it
      // all we honestly know is that the bytes went out.
      return status.confirmed ? "Printed" : "Sent — not confirmed";
    case "error":
      return status.message;
  }
};

export const App: React.FC = () => {
  // The preview is drawn at a higher resolution so it doesn't look jagged; the
  // print canvas stays at the printer's own resolution and is what gets sent.
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const printCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useStored("text", "");
  const [fontFamily, setFontFamily] = useStored("fontFamily", DEFAULT_FONT);
  const [fontWeight, setFontWeight] = useStored("fontWeight", DEFAULT_WEIGHT);
  // Auto means "fill the label": the fit runs from the largest size the label
  // can hold. A fixed size caps it instead.
  const [autoSize, setAutoSize] = useStored("autoSize", "on");
  const [fixedSize, setFixedSize] = useStored("fixedFontSize", 46);
  const auto = autoSize === "on";
  const fontSize = auto ? MAX_FONT_SIZE : fixedSize;
  const [widthMm, setWidthMm] = useStored("labelWidthMm", 12);
  const [lengthMm, setLengthMm] = useStored("labelLengthMm", 40);
  const [pickedCustom, setPickedCustom] = useState(false);
  const [density, setDensity] = useStored("density", 2);
  // Calibration for a printer that lays the image down off-centre. Applied to
  // the canvas that gets sent, never to the preview.
  const [offsetAlong, setOffsetAlong] = useStored("offsetAlong", 0);
  const [offsetAcross, setOffsetAcross] = useStored("offsetAcross", 0);
  const [debug, setDebug] = useStored("debug", "");
  const [log, setLog] = useState<LogEntry[]>([]);

  // The link to the printer outlives any one print, so status can be shown
  // while idle.
  const sessionRef = useRef<Session | null>(null);
  const [connection, setConnection] = useState<"off" | "connecting" | "on">(
    "off",
  );
  const [printerName, setPrinterName] = useState("");
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>({});

  // What the text actually rendered at, after shrink-to-fit.
  const [effectiveSize, setEffectiveSize] = useState(fontSize);
  const [status, setStatus] = useState<PrintStage>({ stage: "idle" });

  const label = { text, fontFamily, fontWeight, fontSize, widthMm, lengthMm };
  const dots = labelDots(label);

  const viewportWidth = useViewportWidth();
  // A long label on a narrow screen scales below 1:1 rather than overflowing.
  const scale = Math.min(
    MAX_PREVIEW_SCALE,
    (Math.min(viewportWidth, PANEL_WIDTH) - 80) / dots.length,
  );
  const previewResolution = Math.ceil(scale * (window.devicePixelRatio || 1));

  useEffect(() => {
    const preview = previewCanvasRef.current;
    const print = printCanvasRef.current;
    if (!preview || !print) {
      return;
    }

    let cancelled = false;

    const render = async () => {
      // Measuring before the face is available would size the text against the
      // fallback font, so the whole measure/fit/draw pass waits.
      await loadFont(fontFamily, fontWeight, fontSize);
      if (cancelled) {
        return;
      }

      drawLabel(preview, label, previewResolution);
      setEffectiveSize(
        drawLabel(print, label, 1, {
          along: offsetAlong,
          across: offsetAcross,
        }),
      );
    };

    render();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    text,
    fontFamily,
    fontWeight,
    fontSize,
    widthMm,
    lengthMm,
    previewResolution,
    offsetAlong,
    offsetAcross,
  ]);

  // Clear a finished print so the readout returns to Ready.
  useEffect(() => {
    if (status.stage !== "done") {
      return;
    }
    const timer = setTimeout(() => setStatus({ stage: "idle" }), 2500);
    return () => clearTimeout(timer);
  }, [status.stage]);

  const printing =
    status.stage === "selecting" ||
    status.stage === "connecting" ||
    status.stage === "sending" ||
    status.stage === "waiting";

  // Ask after the cover and paper while the link is otherwise idle. Whether
  // the printer also volunteers these is model-dependent; polling is the part
  // we can rely on.
  useEffect(() => {
    if (connection !== "on" || printing) {
      return;
    }
    const timer = setInterval(() => {
      const session = sessionRef.current;
      if (session?.connected()) {
        pollPrinter(session);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [connection, printing]);

  const onLog = useCallback(
    (entry: LogEntry) => setLog((entries) => [...entries, entry].slice(-500)),
    [],
  );

  const hooks = useMemo(
    () => ({
      onLog,
      onStatus: (patch: PrinterStatus) =>
        setPrinterStatus((current) => ({ ...current, ...patch })),
      onDisconnected: () => {
        sessionRef.current = null;
        setConnection("off");
        setPrinterStatus({});
      },
    }),
    [onLog],
  );

  const adopt = (session: Session) => {
    sessionRef.current = session;
    setPrinterName(session.name);
    setConnection("on");
    queryPrinter(session);
  };

  // The browser will only open the chooser for a click, but a printer it has
  // already been granted can be picked up again on load.
  useEffect(() => {
    if (!bluetoothAvailable()) {
      return;
    }
    let cancelled = false;
    reconnectPrinter(hooks).then((session) => {
      if (!session) {
        return;
      }
      if (cancelled) {
        session.close();
        return;
      }
      adopt(session);
    });
    return () => {
      cancelled = true;
    };
  }, [hooks]);

  const disconnect = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setConnection("off");
    setPrinterStatus({});
  };

  const connect = async () => {
    const existing = sessionRef.current;
    if (existing?.connected()) {
      return existing;
    }
    setConnection("connecting");
    try {
      const session = await connectPrinter(hooks);
      adopt(session);
      return session;
    } catch (error) {
      setConnection("off");
      if (!isCancellation(error)) {
        onLog({
          time: Date.now(),
          kind: "error",
          message: describeError(error),
        });
        setStatus({ stage: "error", message: describeError(error) });
      }
      return null;
    }
  };

  const onClickPrint = async () => {
    const canvas = printCanvasRef.current;
    if (!canvas) {
      return;
    }
    if (!sessionRef.current?.connected()) {
      setStatus({ stage: "selecting" });
    }
    const session = await connect();
    if (session) {
      printCanvas(canvas, session, { onStage: setStatus, onLog, density });
    } else {
      // Chooser dismissed: drop back to idle without overwriting a real error.
      setStatus((current) =>
        current.stage === "selecting" ? { stage: "idle" } : current,
      );
    }
  };

  const shrunk = effectiveSize < fontSize && text.length > 0;

  // Base UI reads these to show the selected item's label rather than its value.
  const weightItems = findFont(fontFamily).weights.map((weight) => ({
    value: String(weight),
    label: WEIGHT_NAMES[weight] ?? String(weight),
  }));
  const widthItems = WIDTHS_MM.map((mm) => ({
    value: String(mm),
    label: `${mm} mm`,
  }));

  // The dropdown is derived from the dimensions rather than stored alongside
  // them, so a hand-set size can't disagree with the preset it claims to be.
  const sizeItems = [
    ...LABEL_SIZES.map((size) => ({
      value: `${size.widthMm}x${size.lengthMm}`,
      label: `${size.widthMm} × ${size.lengthMm} mm`,
    })),
    { value: CUSTOM_SIZE, label: "Custom" },
  ];
  const matchesPreset = sizeItems.some(
    (item) => item.value === `${widthMm}x${lengthMm}`,
  );
  // Picking "Custom" off a preset keeps the dimensions, so it needs to be
  // remembered rather than derived.
  const custom = pickedCustom || !matchesPreset;
  const sizeValue = custom ? CUSTOM_SIZE : `${widthMm}x${lengthMm}`;

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8">
        <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
              Thermal label maker
            </p>
            {/* The name comes from the printer itself, so there's nothing to
                show until one answers. */}
            <h1 className="font-display text-3xl leading-none font-bold tracking-tight text-foreground uppercase">
              {connection === "on" ? printerName : "No printer"}
            </h1>
          </div>

          <div className="ml-auto flex items-center gap-4">
            {connection === "on" ? (
              <Button
                variant="outline"
                onClick={disconnect}
                className="h-9 font-mono text-[0.625rem] tracking-[0.12em] uppercase"
              >
                Disconnect
              </Button>
            ) : (
              <Button
                onClick={connect}
                disabled={connection === "connecting" || !bluetoothAvailable()}
                className="h-9 font-mono text-[0.625rem] tracking-[0.12em] uppercase"
              >
                {connection === "connecting" ? "Connecting" : "Connect"}
              </Button>
            )}
          </div>
        </header>

        {/* The tape itself: type straight onto the label, exactly as it prints. */}
        <section>
          <div className="flex justify-center rounded-2xl bg-stage px-6 py-8 ring-1 ring-border">
            <div
              onClick={() => inputRef.current?.focus()}
              className="relative cursor-text rounded-[3px] bg-paper shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)]"
              style={{
                width: dots.length * scale,
                height: dots.width * scale,
              }}
            >
              <canvas
                ref={previewCanvasRef}
                className="absolute"
                style={{
                  width: dots.width,
                  height: dots.length,
                  left: (dots.length * scale - dots.width) / 2,
                  top: (dots.width * scale - dots.length) / 2,
                  transform: `rotate(90deg) scale(${scale})`,
                }}
              />
              <input
                ref={inputRef}
                autoFocus
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                aria-label="Label text"
                placeholder=""
                className="absolute inset-0 h-full w-full border-none bg-transparent p-0 text-center outline-none"
                style={{
                  // The canvas underneath is the visible text; the input only
                  // provides the caret and the keyboard.
                  color: "transparent",
                  caretColor: "#000000",
                  fontFamily: `"${fontFamily}", sans-serif`,
                  fontWeight,
                  fontSize: effectiveSize * scale,
                  lineHeight: `${dots.width * scale}px`,
                }}
              />
              {!text && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.2em] text-black/40 uppercase">
                  Type your label
                </span>
              )}
            </div>
          </div>

          {/* Machine readout: what the printer is doing, and what it will lay down. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 font-mono text-[0.6875rem] tracking-[0.12em] uppercase">
            <span
              className={
                status.stage === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              <span
                aria-hidden
                className={`mr-2 inline-block size-1.5 rounded-full align-middle ${
                  status.stage === "error"
                    ? "bg-destructive"
                    : status.stage === "done"
                      ? "bg-ok"
                      : printing
                        ? "animate-pulse bg-primary"
                        : "bg-muted-foreground/40"
                }`}
              />
              {statusText(status)}
            </span>

            {/* What the printer itself says, refreshed while it's connected. */}
            <span className="text-muted-foreground">
              {connection === "on" ? (
                <>
                  {printerName}
                  {printerStatus.battery !== undefined &&
                    ` · ${printerStatus.battery}%`}
                  {printerStatus.coverOpen && (
                    <span className="text-destructive"> · Cover open</span>
                  )}
                  {printerStatus.paper === false && (
                    <span className="text-destructive"> · Out of paper</span>
                  )}
                  {printerStatus.overheated && (
                    <span className="text-destructive"> · Overheated</span>
                  )}
                </>
              ) : connection === "connecting" ? (
                "Connecting…"
              ) : (
                "Not connected"
              )}
            </span>
            <span className="text-muted-foreground">
              {widthMm} × {lengthMm} mm ·{" "}
              {isClamped(label) && (
                <span className="text-foreground">12 mm printable · </span>
              )}
              {fontFamily} {fontWeight} ·{" "}
              {auto || shrunk ? (
                <span className="text-foreground">
                  {effectiveSize} dots {auto ? "auto" : "auto-fit"}
                </span>
              ) : (
                <>{fontSize} dots</>
              )}
            </span>
          </div>
        </section>

        <section className="flex flex-wrap items-end gap-x-8 gap-y-5 rounded-2xl bg-card p-5 ring-1 ring-border">
          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="mb-2 font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
              Type
            </legend>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="font"
                className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Font
              </label>
              <Combobox
                items={FONT_FAMILIES}
                value={fontFamily}
                onValueChange={(value: string | null) => {
                  const family = value ?? DEFAULT_FONT;
                  setFontFamily(family);
                  setFontWeight(nearestWeight(family, fontWeight));
                }}
              >
                <ComboboxInput id="font" className="w-56" />
                <ComboboxContent>
                  <ComboboxEmpty>No font by that name</ComboboxEmpty>
                  <ComboboxList>
                    {(family: string) => (
                      <ComboboxItem key={family} value={family}>
                        <FontName family={family} />
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            <div className="flex flex-col gap-1.5">
              <span
                id="weight-label"
                className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Weight
              </span>
              <Select
                items={weightItems}
                value={String(fontWeight)}
                onValueChange={(value: string | null) =>
                  setFontWeight(Number(value) || DEFAULT_WEIGHT)
                }
              >
                <SelectTrigger
                  className="w-36 bg-card"
                  aria-labelledby="weight-label"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weightItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span
                        style={{
                          fontFamily: `"${fontFamily}"`,
                          fontWeight: Number(item.value),
                        }}
                      >
                        {item.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span
                id="size-mode-label"
                className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Text size
              </span>
              <Select
                items={SIZE_MODES}
                value={auto ? "auto" : "fixed"}
                onValueChange={(value: string | null) =>
                  setAutoSize(value === "fixed" ? "" : "on")
                }
              >
                <SelectTrigger
                  className="w-32 bg-card"
                  aria-labelledby="size-mode-label"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_MODES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="font-mono">{item.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!auto && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="fixed-size"
                  className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
                >
                  At most
                </label>
                <NumberField
                  id="fixed-size"
                  value={fixedSize}
                  onValueChange={(value) => setFixedSize(value ?? fixedSize)}
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  className="w-28"
                  unit="dot"
                />
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="mb-2 font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
              Stock
            </legend>

            <div className="flex flex-col gap-1.5">
              <span
                id="size-label"
                className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Label size
              </span>
              <Select
                items={sizeItems}
                value={sizeValue}
                onValueChange={(value: string | null) => {
                  if (value === CUSTOM_SIZE || value === null) {
                    setPickedCustom(true);
                    return;
                  }
                  const [width, length] = value.split("x").map(Number);
                  setPickedCustom(false);
                  setWidthMm(width);
                  setLengthMm(length);
                }}
              >
                <SelectTrigger
                  className="w-40 bg-card"
                  aria-labelledby="size-label"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sizeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="font-mono">{item.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {custom && (
              <div className="flex flex-col gap-1.5">
                <span
                  id="width-label"
                  className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Width
                </span>
                <Select
                  items={widthItems}
                  value={String(widthMm)}
                  onValueChange={(value: string | null) =>
                    setWidthMm(Number(value))
                  }
                >
                  <SelectTrigger
                    className="w-28 bg-card"
                    aria-labelledby="width-label"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {widthItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        <span className="font-mono">{item.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {custom && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="label-length"
                  className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Length
                </label>
                <NumberField
                  id="label-length"
                  value={lengthMm}
                  onValueChange={(value) => setLengthMm(value ?? lengthMm)}
                  min={10}
                  max={100}
                  className="w-28"
                  unit="mm"
                />
              </div>
            )}
          </fieldset>

          <div className="ml-auto flex items-center gap-3">
            <Button
              onClick={onClickPrint}
              disabled={printing || !bluetoothAvailable()}
              className="h-11 rounded-lg px-7 font-display text-base font-bold tracking-[0.08em] uppercase"
            >
              <PrinterIcon className="size-4" />
              {printing ? "Printing" : "Print"}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2 self-start font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
            <input
              type="checkbox"
              checked={debug === "on"}
              onChange={(event) =>
                setDebug(event.currentTarget.checked ? "on" : "")
              }
              className="size-3.5 accent-primary"
            />
            Debug
          </label>

          {debug === "on" && (
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="density"
                    className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
                  >
                    Density
                  </label>
                  <NumberField
                    id="density"
                    value={density}
                    onValueChange={(value) => setDensity(value ?? density)}
                    min={1}
                    max={15}
                    className="w-24"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="offset-along"
                    className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
                  >
                    Shift along
                  </label>
                  <NumberField
                    id="offset-along"
                    value={offsetAlong}
                    onValueChange={(value) => setOffsetAlong(value ?? 0)}
                    min={-80}
                    max={80}
                    className="w-28"
                    unit="dot"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="offset-across"
                    className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
                  >
                    Shift across
                  </label>
                  <NumberField
                    id="offset-across"
                    value={offsetAcross}
                    onValueChange={(value) => setOffsetAcross(value ?? 0)}
                    min={-40}
                    max={40}
                    className="w-28"
                    unit="dot"
                  />
                </div>

                <Button
                  variant="outline"
                  onClick={async () => {
                    const session = await connect();
                    if (session) {
                      queryPrinter(session);
                    }
                  }}
                  className="h-9 font-mono text-[0.6875rem] tracking-[0.12em] uppercase"
                >
                  Query printer
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setLog([])}
                  className="h-9 font-mono text-[0.6875rem] tracking-[0.12em] uppercase"
                >
                  Clear
                </Button>
              </div>

              <pre className="max-h-72 overflow-auto rounded-lg bg-stage p-3 font-mono text-[0.6875rem] leading-relaxed text-foreground ring-1 ring-border">
                {log.length === 0
                  ? "No traffic yet — print, or query the printer."
                  : log
                      .map(
                        (entry) =>
                          `${new Date(entry.time).toLocaleTimeString()} ${
                            { info: "··", tx: "→", rx: "←", error: "!!" }[
                              entry.kind
                            ]
                          } ${entry.message}`,
                      )
                      .join("\n")}
              </pre>
            </div>
          )}
        </section>
      </div>

      <canvas ref={printCanvasRef} className="hidden" />
    </div>
  );
};
