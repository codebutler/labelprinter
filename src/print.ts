import { canvas2nv, sleep } from "./utils";
import {
  decodeResponses,
  hex,
  INS,
  PAPER_TYPE_GAP,
  type PrinterEvent,
  type PrinterStatus,
} from "./protocol";

const PRINTER_SERVICE = 0xff00;
const CHUNK_SIZE = 100;
// The printer reports "print complete" over a notify characteristic, but only
// if this model's firmware bothers; past this the job is unconfirmed.
const COMPLETE_TIMEOUT_MS = 8000;
// Reconnecting to a printer that's switched off never resolves on its own.
const CONNECT_TIMEOUT_MS = 5000;

export type PrintStage =
  | { stage: "idle" }
  | { stage: "selecting" }
  | { stage: "connecting" }
  | { stage: "sending"; progress: number }
  | { stage: "waiting" }
  | { stage: "done"; confirmed: boolean }
  | { stage: "error"; message: string };

export type OnStage = (status: PrintStage) => void;

export type LogEntry = {
  time: number;
  kind: "info" | "tx" | "rx" | "error";
  message: string;
};

export type OnLog = (entry: LogEntry) => void;

export type SessionHooks = {
  onLog?: OnLog;
  onStatus?: (status: PrinterStatus) => void;
  onDisconnected?: () => void;
};

// Web Bluetooth only exists in Chromium browsers, and only over https or
// localhost.
export const bluetoothAvailable = () =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;

const describe = (error: unknown) => {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError":
        // Also thrown when the chooser is dismissed, but the caller checks for
        // cancellation before reaching here.
        return "No printer found";
      case "SecurityError":
        return "Bluetooth blocked by the browser";
      case "NetworkError":
        return "Lost connection to the printer";
      case "NotSupportedError":
        return "This printer doesn't speak the expected protocol";
      default:
        return error.message || error.name;
    }
  }
  return error instanceof Error ? error.message : String(error);
};

// Thrown by requestDevice both when nothing matches and when the person closes
// the chooser; the latter isn't a failure worth reporting.
export const isCancellation = (error: unknown) =>
  error instanceof DOMException &&
  error.name === "NotFoundError" &&
  /cancel/i.test(error.message);

type Writer = (packet: Uint8Array) => Promise<void>;

export type Session = {
  name: string;
  // Runs a job with sole use of the link, so a status poll can't land in the
  // middle of an image. Everything that writes goes through here.
  exclusive: <T>(job: (write: Writer) => Promise<T>) => Promise<T>;
  send: (...packets: Uint8Array[]) => Promise<void>;
  waitFor: (
    event: PrinterEvent,
    timeout: number,
  ) => Promise<PrinterEvent | null>;
  connected: () => boolean;
  close: () => void;
};

const noLog: OnLog = () => {};

const openSession = async (
  device: BluetoothDevice,
  { onLog = noLog, onStatus, onDisconnected }: SessionHooks,
): Promise<Session> => {
  const log = onLog;
  log({
    time: Date.now(),
    kind: "info",
    message: `Connecting to ${device.name ?? device.id}`,
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE);
  const characteristics = await service.getCharacteristics();
  for (const characteristic of characteristics) {
    const properties = Object.entries(characteristic.properties)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(",");
    log({
      time: Date.now(),
      kind: "info",
      message: `Characteristic ${characteristic.uuid} [${properties}]`,
    });
  }

  const writable = characteristics.find(
    (c) => c.properties.write || c.properties.writeWithoutResponse,
  );
  if (!writable) {
    throw new Error("Printer didn't offer a channel to write to");
  }

  // Which characteristic carries status isn't documented anywhere we can read
  // (the Android app talks classic SPP, not BLE), so subscribe to all of them
  // and let the printer pick.
  const listeners = new Set<(event: PrinterEvent) => void>();

  const onNotify = (notification: Event) => {
    const value = (notification.target as BluetoothRemoteGATTCharacteristic)
      .value;
    if (!value) {
      return;
    }
    const data = new Uint8Array(value.buffer);
    const decoded = decodeResponses(data);
    log({
      time: Date.now(),
      kind: "rx",
      message: `${hex(data)}${
        decoded.length ? `  →  ${decoded.map((r) => r.text).join("; ")}` : ""
      }`,
    });
    for (const response of decoded) {
      if (response.status) {
        onStatus?.(response.status);
      }
      if (response.event) {
        listeners.forEach((listener) => listener(response.event!));
      }
    }
  };

  const notifying: BluetoothRemoteGATTCharacteristic[] = [];
  for (const characteristic of characteristics) {
    if (
      !characteristic.properties.notify &&
      !characteristic.properties.indicate
    ) {
      continue;
    }
    try {
      characteristic.addEventListener("characteristicvaluechanged", onNotify);
      await characteristic.startNotifications();
      notifying.push(characteristic);
    } catch (error) {
      log({
        time: Date.now(),
        kind: "error",
        message: `Couldn't subscribe to ${characteristic.uuid}: ${describe(error)}`,
      });
    }
  }
  log({
    time: Date.now(),
    kind: "info",
    message: notifying.length
      ? `Listening on ${notifying.length} characteristic(s)`
      : "No notify characteristic — status can't be read from this printer",
  });

  const write: Writer = writable.properties.writeWithoutResponse
    ? async (packet) => {
        await writable.writeValueWithoutResponse(packet);
        await sleep(10);
      }
    : async (packet) => {
        await writable.writeValueWithResponse(packet);
      };

  const logged: Writer = async (packet) => {
    log({ time: Date.now(), kind: "tx", message: hex(packet) });
    for (let i = 0; i < packet.length; i += CHUNK_SIZE) {
      await write(packet.slice(i, i + CHUNK_SIZE));
    }
  };

  // One job at a time, in the order they were asked for.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(job: (write: Writer) => Promise<T>): Promise<T> => {
    const run = queue.then(
      () => job(logged),
      () => job(logged),
    );
    queue = run.catch(() => {});
    return run;
  };

  const onGattDisconnected = () => {
    log({ time: Date.now(), kind: "info", message: "Printer disconnected" });
    onDisconnected?.();
  };
  device.addEventListener("gattserverdisconnected", onGattDisconnected);

  return {
    name: device.name ?? "Printer",
    exclusive,
    send: (...packets) =>
      exclusive(async (writePacket) => {
        for (const packet of packets) {
          await writePacket(packet);
        }
      }),
    waitFor: (event, timeout) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          resolve(null);
        }, timeout);
        const listener = (received: PrinterEvent) => {
          // A fault or cancellation must interrupt a wait for completion, but
          // an unrelated event must not satisfy it.
          if (
            received !== event &&
            received !== "cancelled" &&
            received !== "fault"
          ) {
            return;
          }
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(received);
        };
        listeners.add(listener);
      }),
    connected: () => device.gatt?.connected ?? false,
    close: () => {
      device.removeEventListener("gattserverdisconnected", onGattDisconnected);
      notifying.forEach((characteristic) =>
        characteristic.removeEventListener(
          "characteristicvaluechanged",
          onNotify,
        ),
      );
      device.gatt?.disconnect();
    },
  };
};

// Needs a click behind it: the browser only opens the chooser for a gesture.
export const connectPrinter = async (hooks: SessionHooks) => {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE] }],
  });
  return openSession(device, hooks);
};

// Silent reconnect to a printer this browser has already been given
// permission for. getDevices is missing in some Chrome builds (it sits behind
// the new-permissions-backend flag), in which case there's nothing to do but
// wait for a click.
export const reconnectPrinter = async (hooks: SessionHooks) => {
  const log = hooks.onLog ?? noLog;
  if (!bluetoothAvailable() || !navigator.bluetooth.getDevices) {
    log({
      time: Date.now(),
      kind: "info",
      message: "Silent reconnect unsupported in this browser — click Connect",
    });
    return null;
  }

  const [device] = await navigator.bluetooth.getDevices();
  if (!device) {
    return null;
  }

  // A printer that's switched off never finishes connecting.
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      openSession(device, hooks),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Printer didn't answer")),
          CONNECT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    device.gatt?.disconnect();
    log({
      time: Date.now(),
      kind: "info",
      message: `Couldn't reconnect: ${describe(error)}`,
    });
    return null;
  } finally {
    clearTimeout(timer!);
  }
};

// The things worth knowing about a printer that just connected.
export const queryPrinter = (session: Session) =>
  session.send(
    INS.version,
    INS.serial,
    INS.battery,
    INS.paperState,
    INS.coverState,
    INS.getPaperType,
  );

export const pollPrinter = (session: Session) =>
  session.send(INS.paperState, INS.coverState);

export type PrintOptions = {
  onStage: OnStage;
  onLog?: OnLog;
  // 1-15; the Android app's D30 path uses 15 for continuous paper.
  density?: number;
};

export type PrintItem = {
  canvas: HTMLCanvasElement;
  quantity: number;
};

export const printCanvases = async (
  items: PrintItem[],
  session: Session,
  { onStage, onLog = noLog, density = 2 }: PrintOptions,
) => {
  const jobs = items.map(({ canvas, quantity }) => ({
    image: canvas2nv(canvas),
    width: canvas.width,
    height: canvas.height,
    quantity: Math.max(1, Math.min(255, Math.round(quantity))),
  }));
  const totalBytes = jobs.reduce((total, job) => total + job.image.length, 0);
  let sentBytes = 0;

  jobs.forEach((job, index) => {
    onLog({
      time: Date.now(),
      kind: "info",
      message: `Image ${index + 1}/${jobs.length}: ${job.width}x${job.height} dots, ${job.image.length} bytes, quantity ${job.quantity}`,
    });
  });

  try {
    // Held for the whole job: a status poll landing between chunks would end
    // up inside the image.
    const event = await session.exclusive(async (write) => {
      onStage({ stage: "connecting" });
      await write(INS.paperState);
      await write(INS.coverState);

      await write(INS.density(density));
      await write(INS.paperType(PAPER_TYPE_GAP));
      let confirmed = true;

      for (const job of jobs) {
        await write(INS.init);
        await write(INS.repeat(job.quantity));

        // Listen before sending so a very fast completion notification cannot
        // arrive in the gap between the final chunk and waitFor().
        const completion = session.waitFor(
          "complete",
          COMPLETE_TIMEOUT_MS * job.quantity,
        );
        onStage({
          stage: "sending",
          progress: totalBytes === 0 ? 1 : sentBytes / totalBytes,
        });
        await write(INS.printPicture);
        for (let i = 0; i < job.image.length; i += CHUNK_SIZE) {
          const chunk = job.image.slice(i, i + CHUNK_SIZE);
          await write(chunk);
          sentBytes += chunk.length;
          onStage({
            stage: "sending",
            progress: totalBytes === 0 ? 1 : sentBytes / totalBytes,
          });
        }

        // Wait for this design to finish before replacing the printer's image
        // buffer with the next one in the batch.
        onStage({ stage: "waiting" });
        const event = await completion;
        if (event === "cancelled" || event === "fault") {
          return event;
        }
        confirmed = confirmed && event === "complete";
      }

      return confirmed ? "complete" : null;
    });

    if (event === "cancelled") {
      onStage({ stage: "error", message: "The printer cancelled the job" });
    } else if (event === "fault") {
      onStage({
        stage: "error",
        message: "The printer reported a problem — check the debug log",
      });
    } else {
      onStage({ stage: "done", confirmed: event === "complete" });
    }
  } catch (error) {
    onLog({ time: Date.now(), kind: "error", message: describe(error) });
    onStage({ stage: "error", message: describe(error) });
  }
};

export const printCanvas = async (
  canvas: HTMLCanvasElement,
  session: Session,
  options: PrintOptions,
) => printCanvases([{ canvas, quantity: 1 }], session, options);

export const describeError = describe;
