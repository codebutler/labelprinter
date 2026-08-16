// Command and response formats read off the decompiled Print Master app
// (PrintMasterDecompile/decompile/com/project/aimotech/printer/QuinPrinter.java
// and D30Printer.java). Every command is 1f 11 xx, optionally followed by a
// parameter byte.

export const bytes = (...values: number[]) => Uint8Array.from(values);

export const INS = {
  init: bytes(0x1b, 0x40), // INS_PRINTER_INIT
  printPicture: bytes(0x1d, 0x76, 0x30, 0x00), // INS_PRINT_PICTURE
  density: (level: number) => bytes(0x1f, 0x11, 0x02, level),
  // INS_SET_PAPER_TYPE: 0x0b continuous, 0x0a gap labels, 0x26 black mark.
  paperType: (type: number) => bytes(0x1f, 0x11, type),
  repeat: (count: number) => bytes(0x1f, 0x11, 0x21, count),
  paperState: bytes(0x1f, 0x11, 0x11),
  coverState: bytes(0x1f, 0x11, 0x12),
  battery: bytes(0x1f, 0x11, 0x08),
  version: bytes(0x1f, 0x11, 0x07),
  serial: bytes(0x1f, 0x11, 0x09),
  getPaperType: bytes(0x1f, 0x11, 0x19),
} as const;

export const PAPER_TYPE_GAP = 0x0a;

export type PrinterEvent = "complete" | "cancelled" | "fault";

// What the printer tells us about itself, accumulated as replies arrive.
export type PrinterStatus = {
  paper?: boolean;
  coverOpen?: boolean;
  overheated?: boolean;
  battery?: number;
  firmware?: string;
  serial?: string;
  paperType?: string;
};

export type Response = {
  // How many bytes this response consumed, so a packet holding several can be
  // walked.
  length: number;
  text: string;
  event?: PrinterEvent;
  status?: PrinterStatus;
};

const percent = (raw: number) => {
  switch (raw) {
    case 0xa1:
      return 10;
    case 0xa2:
      return 5;
    case 0xa3:
      return 3;
    default:
      return raw;
  }
};

// Mirrors QuinPrinter.InstructionProcessor.process. Responses are a type byte
// plus a payload, sometimes preceded by 0x1a.
const decodeAt = (data: Uint8Array, start: number): Response => {
  const offset = data[start] === 0x1a ? start + 1 : start;
  const type = data[offset];
  const arg = data[offset + 1];
  const consumed = offset - start + 2;

  switch (type) {
    case 0x03:
      return {
        length: consumed,
        text: arg === 0xa9 ? "Overheating" : "Temperature normal",
        event: arg === 0xa9 ? "fault" : undefined,
        status: { overheated: arg === 0xa9 },
      };
    case 0x04:
      return {
        length: consumed,
        text: `Battery ${percent(arg)}%`,
        status: { battery: percent(arg) },
      };
    case 0x05:
      return {
        length: consumed,
        text: arg === 0x99 ? "Cover open" : "Cover closed",
        event: arg === 0x99 ? "fault" : undefined,
        status: { coverOpen: arg === 0x99 },
      };
    case 0x06:
      return {
        length: consumed,
        text: arg === 0x88 ? "Out of paper" : "Paper loaded",
        event: arg === 0x88 ? "fault" : undefined,
        status: { paper: arg !== 0x88 },
      };
    case 0x07: {
      const firmware = `${arg}.${data[offset + 2]}.${data[offset + 3]}`;
      return {
        length: consumed + 2,
        text: `Firmware ${firmware}`,
        status: { firmware },
      };
    }
    case 0x08: {
      const serial = String.fromCharCode(
        ...data.slice(offset + 1, offset + 16),
      );
      return {
        length: consumed + 14,
        text: `Serial ${serial}`,
        status: { serial },
      };
    }
    case 0x09:
      return { length: consumed, text: `Auto power off ${arg} min` };
    case 0x0b:
      return arg === 0xb8
        ? { length: consumed, text: "Print cancelled", event: "cancelled" }
        : { length: consumed, text: `Cancel state ${arg}` };
    case 0x0c: {
      const paper =
        arg === 0x0b ? "continuous" : arg === 0x26 ? "black mark" : "gap label";
      return {
        length: consumed,
        text: `Paper type: ${paper}`,
        status: { paperType: paper },
      };
    }
    case 0x0f:
      return arg === 0x0c
        ? { length: consumed, text: "Print complete", event: "complete" }
        : { length: consumed, text: `Print state ${arg}` };
    case 0x15:
      return {
        length: consumed + 2,
        text: `Consumable ${arg} remaining ${data[offset + 2] * 256 + data[offset + 3]}`,
      };
    case 0x3f:
      return {
        length: consumed,
        text: `Consumable error ${arg}`,
        event: "fault",
      };
    default:
      // Unknown type: stop rather than risk desyncing on the rest.
      return { length: data.length - start, text: "Unrecognized" };
  }
};

export const decodeResponses = (data: Uint8Array) => {
  const responses: Response[] = [];
  let offset = 0;
  while (offset < data.length - 1) {
    const response = decodeAt(data, offset);
    responses.push(response);
    offset += Math.max(1, response.length);
  }
  return responses;
};

export const hex = (data: Uint8Array) =>
  Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
