// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/image-caption.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/** The picture's caption and alt text are one value, edited under the picture.
 * This DOM node view is shared by React and vanilla hosts. The mirror reserves
 * the caption's height, so hover/focus never moves the picture or its siblings. */
import type { NodeViewRenderer } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { FormattedImageAttrs } from "../../common-models";
import { imageElementAttributes, imageSpanAttributes } from "../../image-css";

export const CAPTION_LABEL = "Caption";
export const CAPTION_PROMPT = "Add caption";

/** View updates include setEditable(false, false): no document-change event
 * is required to keep embedded controls in step with their host's lock. */
export const captionEditablePlugin = () =>
  new Plugin({
    view(view) {
      const sync = () =>
        view.dom
          .querySelectorAll<HTMLTextAreaElement>(".kk-fm-caption-input")
          .forEach((input) => {
            input.disabled = !view.editable;
          });
      sync();
      return { update: sync };
    },
  });

export const imageCaptionView =
  (shownSrc?: (src: string) => string): NodeViewRenderer =>
  ({ node: initial, editor, view, getPos }) => {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("span");
    const img = doc.createElement("img");
    const caption = doc.createElement("span");
    caption.className = "kk-fm-caption";
    caption.contentEditable = "false";
    caption.dataset.prompt = CAPTION_PROMPT;
    const mirror = doc.createElement("span");
    mirror.className = "kk-fm-caption-mirror";
    mirror.setAttribute("aria-hidden", "true");
    const input = doc.createElement("textarea");
    input.className = "kk-fm-caption-input";
    input.setAttribute("aria-label", CAPTION_LABEL);
    input.maxLength = 500;
    input.rows = 1;
    input.spellcheck = true;
    caption.append(mirror, input);
    dom.append(img, caption);
    let node = initial;
    const paint = () => {
      const selected = dom.classList.contains("ProseMirror-selectednode");
      const stored = node.attrs as FormattedImageAttrs;
      dom.removeAttribute("data-look");
      dom.removeAttribute("data-align");
      for (const [key, value] of Object.entries(imageSpanAttributes(stored)))
        dom.setAttribute(key, value);
      if (selected) dom.classList.add("ProseMirror-selectednode");
      dom.contentEditable = "false";
      const attrs = imageElementAttributes(stored);
      const src = shownSrc?.(attrs.src) || attrs.src;
      for (const [key, value] of Object.entries({ ...attrs, src }))
        img.setAttribute(key, value);
      if (src !== attrs.src) img.dataset.kkSrc = attrs.src;
      else delete img.dataset.kkSrc;
      if (input.value !== attrs.alt) input.value = attrs.alt;
      mirror.textContent = `${input.value}\u200b`;
      caption.dataset.empty = String(!input.value);
    };
    const commit = () => {
      const pos = getPos();
      if (typeof pos !== "number" || editor.isDestroyed || !editor.isEditable)
        return;
      const current = editor.state.doc.nodeAt(pos);
      if (current?.type !== node.type || current.attrs.alt === input.value)
        return;
      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(pos, "alt", input.value),
      );
    };
    const leave = () => {
      commit();
      const pos = getPos();
      if (typeof pos === "number" && !editor.isDestroyed)
        editor
          .chain()
          .focus()
          .setTextSelection(pos + node.nodeSize)
          .run();
    };
    input.addEventListener("input", (event) => {
      mirror.textContent = `${input.value}\u200b`;
      caption.dataset.empty = String(!input.value);
      if (!(event as InputEvent).isComposing) commit();
    });
    input.addEventListener("compositionend", commit);
    input.addEventListener("blur", commit);
    input.addEventListener("focus", () => {
      const pos = getPos();
      if (typeof pos === "number" && !editor.isDestroyed)
        editor.commands.setNodeSelection(pos);
    });
    input.addEventListener("keydown", (event) => {
      const primary = event.metaKey || event.ctrlKey;
      if (event.isComposing) {
        event.stopPropagation();
        return;
      }
      // The host sends on Shift+Command+Return, including from a caption.
      if (primary && event.shiftKey && event.key === "Enter") {
        commit();
        return;
      }
      event.stopPropagation();
      if (primary && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.commands.redo();
        else editor.commands.undo();
      } else if (
        event.key === "Enter" &&
        primary &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        editor.commands.toggleBlockControl();
      } else if (
        event.key === "Escape" ||
        (event.key === "Enter" && !event.shiftKey)
      ) {
        event.preventDefault();
        leave();
      }
    });
    caption.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.disabled = !editor.options.editable;
    paint();
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        paint();
        return true;
      },
      stopEvent: (event) =>
        !!event.target && caption.contains(event.target as globalThis.Node),
      ignoreMutation: () => true,
    };
  };
