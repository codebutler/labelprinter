import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type NumberFieldProps = NumberFieldPrimitive.Root.Props & {
  unit?: string;
  className?: string;
};

export function NumberField({ unit, className, ...props }: NumberFieldProps) {
  return (
    <NumberFieldPrimitive.Root {...props}>
      <NumberFieldPrimitive.Group
        className={cn(
          "flex h-8 items-center rounded-lg border border-input bg-card text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          className,
        )}
      >
        <NumberFieldPrimitive.Decrement
          className="flex h-full w-7 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Decrease"
        >
          <MinusIcon className="size-3.5" />
        </NumberFieldPrimitive.Decrement>
        <div className="relative flex flex-1 items-center">
          <NumberFieldPrimitive.Input
            className={cn(
              "w-full bg-transparent text-center font-mono tabular-nums outline-none",
              unit && "pr-5",
            )}
          />
          {unit && (
            <span className="pointer-events-none absolute right-1 font-mono text-[0.6875rem] text-muted-foreground">
              {unit}
            </span>
          )}
        </div>
        <NumberFieldPrimitive.Increment
          className="flex h-full w-7 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Increase"
        >
          <PlusIcon className="size-3.5" />
        </NumberFieldPrimitive.Increment>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );
}
