function removeZalgoText(text: string): string {
  // Match combining characters that are commonly used in Zalgo text
  // Using a more explicit approach to avoid misleading-character-class warning
  const combiningMarks = [
    /[\u0300-\u036F]/g, // Combining Diacritical Marks
    /[\u1AB0-\u1AFF]/g, // Combining Diacritical Marks Extended
    /[\u1DC0-\u1DFF]/g, // Combining Diacritical Marks Supplement
    /[\u20D0-\u20FF]/g, // Combining Diacritical Marks for Symbols
    /[\uFE20-\uFE2F]/g, // Combining Half Marks
  ];

  let result = text;
  for (const regex of combiningMarks) {
    result = result.replace(regex, "");
  }
  return result;
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  // Inert document: an <img onerror> would fire if parsed into the live document first.
  const tempDiv = new DOMParser().parseFromString(html, "text/html").body;

  const disallowedSelectors = [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
  ];
  for (const sel of disallowedSelectors) {
    for (const el of tempDiv.querySelectorAll(sel)) {
      el.remove();
    }
  }

  // Remove code and pre tags but keep their text content
  for (const el of tempDiv.querySelectorAll("code, pre")) {
    const textNode = document.createTextNode(el.textContent || "");
    el.replaceWith(textNode);
  }

  for (const el of tempDiv.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "src" ||
        name === "href"
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const value = textNode.nodeValue || "";
    textNode.nodeValue = removeZalgoText(value);
  }

  const cleanHtml = tempDiv.innerHTML.trim();
  return cleanHtml;
}

export function stripHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  // Inert document: an <img onerror> would fire if parsed into the live document first.
  const tempDiv = new DOMParser().parseFromString(html, "text/html").body;
  let cleanText = tempDiv.textContent || tempDiv.innerText || "";

  cleanText = removeZalgoText(cleanText);

  return cleanText;
}

/**
 * For store-provided rich HTML (game descriptions, system requirements): keeps images, videos and
 * links but only with http(s) URLs, and drops scripts, frames, styles and event handlers. Parsing
 * happens in an inert DOMParser document, so nothing loads or runs while sanitizing.
 */
export function sanitizeRichHtml(html: string): string {
  if (!html || typeof html !== "string") return "";

  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const el of doc.querySelectorAll(
    "script, style, iframe, frame, frameset, object, embed, link, meta, base, form, input, button, textarea, select, svg, math, template"
  )) {
    el.remove();
  }

  const isSafeUrl = (value: string) => {
    try {
      return ["http:", "https:"].includes(new URL(value, "https://invalid.local").protocol) &&
        !/^\s*(javascript|data|vbscript|file):/i.test(value);
    } catch {
      return false;
    }
  };

  for (const el of doc.body.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc" || name === "formaction") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (["src", "href", "poster", "srcset", "data", "action", "xlink:href"].includes(name)) {
        const values = name === "srcset" ? attr.value.split(",").map((part) => part.trim().split(/\s+/)[0]) : [attr.value];
        if (!values.every(isSafeUrl)) el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === "A") {
      el.setAttribute("rel", "noopener noreferrer");
      el.setAttribute("target", "_blank");
    }
  }

  return doc.body.innerHTML;
}
