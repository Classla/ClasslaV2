// Shared utilities for all block types

/**
 * Generate a UUID v4 compatible ID
 */
export const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Utility function to convert HTML to plain text for display
 */
export const htmlToText = (html: string): string => {
  if (!html || html.trim() === "") return "";

  // Create a temporary div to parse HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // Get text content and clean up
  const text = tempDiv.textContent || tempDiv.innerText || "";
  return text.trim();
};

/**
 * Check if HTML content is empty
 */
export const isEmptyContent = (html: string): boolean => {
  if (!html || html.trim() === "") return true;
  // Check for empty paragraph tags or just whitespace
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const textContent = tempDiv.textContent || tempDiv.innerText || "";
  return textContent.trim() === "";
};

