import sanitizeHtml from "sanitize-html";

export interface SanitizeEmailOptions {
  allowRemoteImages?: boolean;
}

/**
 * Checks whether the HTML contains remote image URLs (http://, https://, or protocol-relative //)
 * or images that have already been marked as blocked.
 */
export function hasRemoteImages(rawHtml?: string | null): boolean {
  if (!rawHtml) return false;
  return /<img[^>]+src\s*=\s*["']?\s*(?:https?:)?\/\/[^"'>\s]+/i.test(rawHtml) ||
         /data-blocked-src\s*=\s*["']?\s*(?:https?:)?\/\/[^"'>\s]+/i.test(rawHtml);
}

export function sanitizeEmailHtml(rawHtml?: string | null, options: SanitizeEmailOptions = {}): string {
  if (!rawHtml) return "";
  const allowRemoteImages = options.allowRemoteImages ?? false;

  // Pre-strip any dangerous url(), javascript:, expression(), or behavior in style attributes
  const preProcessed = rawHtml.replace(/style\s*=\s*(["\x27])[^"\x27]*\1/gi, (match) => {
    if (/url\s*\(|javascript\s*:|expression\s*\(|behavior\s*:/i.test(match)) {
      return "";
    }
    return match;
  });

  return sanitizeHtml(preProcessed, {
    allowedTags: [
      "p", "br", "b", "i", "strong", "em", "u", "s", "strike", "del",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li",
      "span", "div", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
      "img", "a", "hr", "pre", "code", "font", "center"
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height", "style", "align", "data-blocked-src"],
      "*": ["style", "class", "align", "color", "bgcolor", "width", "height", "border", "cellpadding", "cellspacing"]
    },
    allowedStyles: {
      "*": {
        "color": [/^(#(0x)?[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)$/i],
        "background-color": [/^(#(0x)?[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)$/i],
        "text-align": [/^(left|right|center|justify)$/i],
        "font-size": [/^\d+(\.\d+)?(px|em|rem|%|pt)$/i],
        "font-weight": [/^(bold|normal|[1-9]00)$/i],
        "font-style": [/^(italic|normal|oblique)$/i],
        "text-decoration": [/^(none|underline|line-through|overline)$/i],
        "line-height": [/^\d+(\.\d+)?(px|em|rem|%)?$/i],
        "font-family": [/^[^;()]+$/i],
        "margin": [/^[0-9pxemr%\s-]+$/i],
        "margin-top": [/^[0-9pxemr%-]+$/i],
        "margin-bottom": [/^[0-9pxemr%-]+$/i],
        "margin-left": [/^[0-9pxemr%-]+$/i],
        "margin-right": [/^[0-9pxemr%-]+$/i],
        "padding": [/^[0-9pxemr%\s]+$/i],
        "padding-top": [/^[0-9pxemr%]+$/i],
        "padding-bottom": [/^[0-9pxemr%]+$/i],
        "padding-left": [/^[0-9pxemr%]+$/i],
        "padding-right": [/^[0-9pxemr%]+$/i],
        "border": [/^[^;()]+$/i],
        "border-top": [/^[^;()]+$/i],
        "border-bottom": [/^[^;()]+$/i],
        "border-left": [/^[^;()]+$/i],
        "border-right": [/^[^;()]+$/i],
        "border-radius": [/^[0-9pxemr%\s]+$/i],
        "width": [/^[0-9pxemr%]+$/i],
        "max-width": [/^[0-9pxemr%]+$/i],
        "height": [/^[0-9pxemr%]+$/i],
        "display": [/^(inline|block|inline-block|table|table-row|table-cell|flex|none)$/i],
      }
    },
    allowedSchemes: ["http", "https", "mailto", "data", "cid"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto"],
      img: ["http", "https", "cid", "data"],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
      img: (tagName, attribs) => {
        const src = (attribs.src || "").trim();
        const isRemote = /^(https?:)?\/\//i.test(src);
        if (!allowRemoteImages && isRemote) {
          return {
            tagName: "img",
            attribs: {
              ...attribs,
              src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='18' height='18' x='3' y='3' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><path d='m21 15-5-5L5 21'/></svg>",
              "data-blocked-src": src,
              alt: attribs.alt ? `${attribs.alt} [Remote image blocked]` : "[Remote image blocked]",
              title: "Remote image blocked to protect privacy. Click 'Load Images' to display.",
              style: `${attribs.style || ""}; max-width: 100%; border: 1px dashed #94a3b8; border-radius: 4px; padding: 4px;`.trim(),
            },
          };
        }
        return {
          tagName,
          attribs,
        };
      },
    },
  });
}
