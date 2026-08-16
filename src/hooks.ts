import { useEffect, useState } from "react";

// Literal defaults would otherwise narrow the state type to that one value.
type Widen<T> = T extends string ? string : T extends number ? number : T;

// Replaces Mantine's useLocalStorage. Values are stored raw rather than
// JSON-encoded, so the stored text is readable in devtools.
export const useStored = <T extends string | number>(
  key: string,
  defaultValue: T,
) => {
  const [value, setValue] = useState<Widen<T>>(() => {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return defaultValue as Widen<T>;
    }
    return (
      typeof defaultValue === "number" ? Number(stored) : stored
    ) as Widen<T>;
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue] as const;
};

export const useViewportWidth = () => {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width;
};
