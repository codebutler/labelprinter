// Font configurations for thermal printer optimized fonts
export const FONTS: Record<
  string,
  { name: string; system?: boolean; url?: string; import?: boolean }
> = {
  // System fonts (no loading needed)
  monospace: { name: "Monospace", system: true },
  "Courier New, monospace": { name: "Courier New", system: true },
  "Consolas, monospace": { name: "Consolas", system: true },
  "Arial, sans-serif": { name: "Arial", system: true },
  "Helvetica, sans-serif": { name: "Helvetica", system: true },
  "Verdana, sans-serif": { name: "Verdana", system: true },
  "Tahoma, sans-serif": { name: "Tahoma", system: true },
  "system-ui": { name: "System UI", system: true },
  "Impact, sans-serif": { name: "Impact", system: true },
  "Arial Black, sans-serif": { name: "Arial Black", system: true },

  // OCR fonts - designed for machine readability
  "'OCR-A BT', sans-serif": {
    name: "OCR-A (Best for thermal)",
    url: "https://fonts.cdnfonts.com/css/ocr-a-bt",
    import: true,
  },
  "'Share Tech Mono', monospace": {
    name: "Share Tech Mono",
    url: "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap",
    import: true,
  },
  "'Azeret Mono', monospace": {
    name: "Azeret Mono",
    url: "https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;500;600;700;800;900&display=swap",
    import: true,
  },

  // Pixel/bitmap fonts - great for low resolution
  "VT323, monospace": {
    name: "VT323 (Terminal)",
    url: "https://fonts.googleapis.com/css2?family=VT323&display=swap",
    import: true,
  },
  "Silkscreen, monospace": {
    name: "Silkscreen (Pixel)",
    url: "https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap",
    import: true,
  },

  // Modern monospace fonts optimized for readability
  "'JetBrains Mono', monospace": {
    name: "JetBrains Mono",
    url: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap",
    import: true,
  },
  "'Roboto Mono', monospace": {
    name: "Roboto Mono",
    url: "https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap",
    import: true,
  },
  "'Space Mono', monospace": {
    name: "Space Mono",
    url: "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap",
    import: true,
  },
};

// Track loaded fonts
export const loadedFonts = new Set<string>();

// Helper function to load a font dynamically
export const loadFont = (fontFamily: string) => {
  const fontConfig = FONTS[fontFamily];
  if (fontConfig && fontConfig.url && !loadedFonts.has(fontFamily)) {
    loadedFonts.add(fontFamily);

    if (fontConfig.import) {
      // Load Google Fonts via @import
      const link = document.createElement("link");
      link.href = fontConfig.url;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    } else {
      // Load font via @font-face
      const style = document.createElement("style");
      style.textContent = `
        @font-face {
          font-family: '${fontFamily}';
          src: url('${fontConfig.url}') format('woff2');
          font-weight: normal;
          font-style: normal;
        }
      `;
      document.head.appendChild(style);
    }
  }
};

// Helper function to get font groups for the Select component
export const getFontGroups = () => {
  const groups: Record<string, Array<{ value: string; label: string }>> = {
    "System Fonts": [],
    "OCR Fonts (Best for Thermal)": [],
    "Pixel/Bitmap Fonts": [],
    "Modern Monospace": [],
  };

  Object.entries(FONTS).forEach(([value, config]) => {
    const item = { value, label: config.name };
    if (config.system) {
      groups["System Fonts"].push(item);
    } else if (value.includes("OCR") || value.includes("Share Tech") || value.includes("Azeret")) {
      groups["OCR Fonts (Best for Thermal)"].push(item);
    } else if (value.includes("VT323") || value.includes("Silkscreen")) {
      groups["Pixel/Bitmap Fonts"].push(item);
    } else {
      groups["Modern Monospace"].push(item);
    }
  });

  return Object.entries(groups)
    .filter(([_, items]) => items.length > 0)
    .map(([group, items]) => ({ group, items }));
};
