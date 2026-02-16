import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface AccordionContextValue {
  openItems: Set<string>;
  toggleItem: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | undefined>(
  undefined
);

const AccordionItemContext = React.createContext<{ value: string } | undefined>(
  undefined
);

interface AccordionProps {
  children: React.ReactNode;
  type?: "single" | "multiple";
  defaultValue?: string[];
  className?: string;
}

export const Accordion: React.FC<AccordionProps> = ({
  children,
  type = "multiple",
  defaultValue = [],
  className,
}) => {
  const [openItems, setOpenItems] = React.useState<Set<string>>(
    new Set(defaultValue)
  );

  const toggleItem = React.useCallback((value: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        if (type === "single") {
          next.clear();
        }
        next.add(value);
      }
      return next;
    });
  }, [type]);

  return (
    <AccordionContext.Provider value={{ openItems, toggleItem }}>
      <div className={cn("space-y-2", className)}>{children}</div>
    </AccordionContext.Provider>
  );
};

interface AccordionItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export const AccordionItem: React.FC<AccordionItemProps> = ({
  value,
  children,
  className,
}) => {
  const context = React.useContext(AccordionContext);
  if (!context) {
    throw new Error("AccordionItem must be used within Accordion");
  }

  const isOpen = context.openItems.has(value);

  return (
    <AccordionItemContext.Provider value={{ value }}>
      <div
        className={cn(
          "border rounded-lg overflow-hidden",
          isOpen && "border-purple-200",
          className
        )}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
};

interface AccordionTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export const AccordionTrigger: React.FC<AccordionTriggerProps> = ({
  children,
  className,
}) => {
  const context = React.useContext(AccordionContext);
  if (!context) {
    throw new Error("AccordionTrigger must be used within Accordion");
  }

  const itemContext = React.useContext(AccordionItemContext);
  if (!itemContext) {
    throw new Error("AccordionTrigger must be used within AccordionItem");
  }

  const isOpen = context.openItems.has(itemContext.value);

  return (
    <button
      type="button"
      onClick={() => context.toggleItem(itemContext.value)}
      className={cn(
        "flex w-full items-center justify-between p-4 text-left hover:bg-accent transition-colors",
        className
      )}
    >
      {children}
      <ChevronDown
        className={cn(
          "h-4 w-4 text-muted-foreground transition-transform",
          isOpen && "transform rotate-180"
        )}
      />
    </button>
  );
};

interface AccordionContentProps {
  children: React.ReactNode;
  className?: string;
}

export const AccordionContent: React.FC<AccordionContentProps> = ({
  children,
  className,
}) => {
  const context = React.useContext(AccordionContext);
  if (!context) {
    throw new Error("AccordionContent must be used within Accordion");
  }

  const itemContext = React.useContext(AccordionItemContext);
  if (!itemContext) {
    throw new Error("AccordionContent must be used within AccordionItem");
  }

  const isOpen = context.openItems.has(itemContext.value);

  if (!isOpen) return null;

  return (
    <div className={cn("p-4 pt-0", className)}>
      {children}
    </div>
  );
};
