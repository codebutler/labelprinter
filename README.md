# Label Printer

Print labels on a [Phomemo D30](https://amzn.to/49ZaWpn) from a browser tab, over
Bluetooth. No app, no account, nothing to install.

**[codebutler.github.io/labelprinter](https://codebutler.github.io/labelprinter/)**

Build a list of labels and press Print once to send the whole batch. Each label
has its own quantity, and text uses any of the ~1,900 Google Fonts.

## Requirements

A Chromium browser — Chrome, Edge, Arc, Brave — on desktop or Android. It needs
[Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API),
which Safari and Firefox don't implement, so iOS is out entirely. The page must
be served over HTTPS or from localhost.

## Using it

Press **Connect** and pick the printer. The connection stays open, so the
header shows the device's own name and the readout tracks battery, paper and
cover while you work — open the cover and it says so within a few seconds.

Type straight onto any label preview; each preview also has its own quantity
control. What's on screen comes from the same drawing code as the canvas sent
to the printer.

- **Text size** — *Auto* chooses the largest size that fits every label, so the
  whole batch uses consistent type. *Fixed* sets a ceiling and still shrinks
  the batch to fit under it.
- **Label size** — the stock in the printer. 12 × 40 mm and 14 × 60 mm are
  presets; *Custom* takes any dimensions.
- **Debug** — a hex log of everything sent and received, decoded; a density
  control; and calibration nudges for a printer that lays the image down
  off-centre.

Printing is confirmed rather than assumed: the status reads **Printed** only
when the printer says so. If it reports nothing back, you get **Sent — not
confirmed** instead, because bytes leaving the browser aren't ink on tape.

## How it works

The printer takes a 1-bit raster, one row at a time, over a
[GATT](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
characteristic on service `0xff00`. At 203 dpi that's 8 dots/mm, so a 12 × 40 mm
label is exactly 96 × 320 dots.

Text is drawn to a canvas rotated 90°, since the tape feeds sideways relative
to the head. Two canvases are kept: a high-resolution one for the preview, and
one at the printer's own resolution that becomes the payload. Both come from
the same drawing code.

Two things worth knowing if you're changing this:

- **The print head is 96 dots wide regardless of the tape.** 12 mm is all it
  can reach; wider stock just gets a 12 mm band. Sending wider rows makes the
  printer drop the job silently.
- **Canvas falls back to a default face when a font hasn't loaded**, without
  telling you. Every measure/fit/draw waits on `document.fonts.check` first, or
  the label gets sized against the wrong font.

The command set and status responses were read off the decompiled vendor
Android app and are documented in [`src/protocol.ts`](src/protocol.ts):
commands are `1f 11 xx`, replies are a type byte plus payload — `0f 0c` for
print complete, `05 99` for cover open, and so on.

### Layout

| File | |
|---|---|
| [`src/label.ts`](src/label.ts) | Geometry, auto-fit and drawing. No framework. |
| [`src/print.ts`](src/print.ts) | Bluetooth session, print flow, status polling. |
| [`src/protocol.ts`](src/protocol.ts) | Printer commands and response decoding. |
| [`src/fonts.ts`](src/fonts.ts) | The Google Fonts catalogue and face loading. |
| [`src/utils.ts`](src/utils.ts) | Canvas → 1-bit raster. |
| [`src/App.tsx`](src/App.tsx) | The interface. |

## Development

```sh
bun install
bun run dev
```

Then `bun run lint` and `bun run build` — the same two the deploy runs.

The font catalogue is generated, not hand-written. `bun run fonts:generate`
rebuilds [`src/google-fonts.json`](src/google-fonts.json) from the
`google-font-metadata` package: every family with a latin subset, with the
weights it actually ships. It's checked in, so a build never needs the network.

React 19, Vite, Tailwind v4, and [shadcn](https://ui.shadcn.com) components on
[Base UI](https://base-ui.com).

## Deploying

Pushing to `main` publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Lint and build
run first, so a type error fails the deploy instead of shipping a broken page.

Hosting it elsewhere means changing `base` in
[`vite.config.ts`](vite.config.ts) — it's set to `/labelprinter/` for the
project-site subpath, and wants to be `/` at a domain root.

## License

MIT
