import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export const Popover: React.FC<PopoverProps> = ({
  trigger,
  content,
  className = "",
  align = "right",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = triggerRect.bottom + 8; // 8px gap
      let left = triggerRect.left;

      // Adjust horizontal position based on alignment
      if (align === "right") {
        left = triggerRect.right - 320; // Assuming popover width of 320px
      } else if (align === "center") {
        left = triggerRect.left + triggerRect.width / 2 - 160; // Center align
      }

      // Ensure popover doesn't go off screen horizontally
      if (left < 8) {
        left = 8;
      } else if (left + 320 > viewportWidth - 8) {
        left = viewportWidth - 320 - 8;
      }

      // Ensure popover doesn't go off screen vertically
      if (top + 200 > viewportHeight - 8) {
        // Assuming max popover height of 200px
        top = triggerRect.top - 200 - 8; // Show above trigger
      }

      setPosition({ top, left });
    }
  }, [isOpen, align]);

  const handleTriggerClick = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <div ref={triggerRef} onClick={handleTriggerClick}>
        {trigger}
      </div>
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className={`fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg ${className}`}
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              minWidth: "320px",
            }}
            data-popover="true"
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
