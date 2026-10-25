// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/image-caption.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/** The picture's caption and alt text are one value, edited under the picture.
 * This DOM node view is shared by React and vanilla hosts. Empty captions have
 * three states: a thin edge, a prompt below the picture, and an editing field. */
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
            const caption = input.parentElement;
            const add = caption?.querySelector<HTMLButtonElement>("button");
            if (add) add.disabled = !view.editable;
            if (!view.editable && caption?.dataset.empty === "true") {
              caption.dataset.state = "rest";
              add?.setAttribute("aria-expanded", "false");
            }
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
    const add = doc.createElement("button");
    add.type = "button";
    add.className = "kk-fm-caption-add";
    add.textContent = CAPTION_PROMPT;
    add.setAttribute("aria-label", CAPTION_PROMPT);
    caption.append(mirror, input, add);
    dom.append(img, caption);
    let node = initial;
    type CaptionState = "rest" | "prompt" | "editing" | "caption";
    const setState = (state: CaptionState) => {
      caption.dataset.state = state;
      add.setAttribute("aria-expanded", String(state !== "rest"));
      add.setAttribute(
        "aria-hidden",
        String(
          (state === "editing" || state === "caption") &&
            !add.matches(":focus"),
        ),
      );
      input.tabIndex = state === "rest" || state === "prompt" ? -1 : 0;
      add.tabIndex = state === "rest" || state === "prompt" ? 0 : -1;
    };
    const editCaption = () => {
      setState("editing");
      input.focus();
    };
    const syncCaption = () => {
      // The prompt and the empty caret use the same height, including wrapping
      // in narrow thumbnails. Only the caption's contents change on activation.
      mirror.textContent = `${input.value || CAPTION_PROMPT}\u200b`;
      caption.dataset.empty = String(!input.value);
      if (input.matches(":focus")) setState("editing");
      else if (input.value) setState("caption");
      else if (caption.dataset.state !== "prompt") setState("rest");
    };
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
      syncCaption();
    };
    const commit = () => {
      const pos = getPos();
      if (typeof pos !== "number" || editor.isDestroyed || !editor.isEditable)
        return;
      const current = editor.state.doc.nodeAt(pos);
      if (current?.type !== node.type || current.attrs.alt === input.value)
        return;
      // A mapped leaf replacement lets history group adjacent caption
      // typing. AttrStep has an empty map and splits every character.
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          alt: input.value,
        }),
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
      syncCaption();
      if (!(event as InputEvent).isComposing) commit();
    });
    input.addEventListener("compositionend", commit);
    input.addEventListener("blur", () => {
      commit();
      setState(input.value ? "caption" : "rest");
    });
    input.addEventListener("focus", () => {
      setState("editing");
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
    add.addEventListener("pointerenter", (event) => {
      if (!add.disabled && event.pointerType !== "touch") setState("prompt");
    });
    caption.addEventListener("pointerleave", (event) => {
      if (
        event.pointerType !== "touch" &&
        caption.dataset.state === "prompt" &&
        !add.matches(":focus")
      )
        setState("rest");
    });
    add.addEventListener("focus", () => {
      if (!add.disabled && add.matches(":focus-visible")) setState("prompt");
    });
    add.addEventListener("blur", () => {
      if (caption.dataset.state === "prompt") setState("rest");
    });
    // Safari's synthesized click omits pointerType. Preserve the pointer's
    // modality; cancelling touch pointerdown also cancels Safari's click.
    let pointerAction: "reveal" | "edit" = "edit";
    add.addEventListener("pointerdown", (event) => {
      const touch = event.pointerType === "touch";
      // Remember this before the browser focuses the button. Safari may then
      // reveal its focus cue before dispatching the synthetic click.
      pointerAction =
        touch && caption.dataset.state === "rest" ? "reveal" : "edit";
      if (!touch) event.preventDefault();
    });
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (add.disabled) return;
      if (pointerAction === "reveal") {
        pointerAction = "edit";
        setState("prompt");
      } else editCaption();
    });
    add.addEventListener("keydown", (event) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        editCaption();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setState("rest");
        leave();
      }
    });
    const dismissPrompt = (event: PointerEvent) => {
      if (
        caption.dataset.state === "prompt" &&
        !event.composedPath().includes(caption)
      )
        setState("rest");
    };
    const enterPrompt = (event: KeyboardEvent) => {
      if (
        caption.dataset.state === "prompt" &&
        !add.disabled &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        editCaption();
      }
    };
    view.dom.addEventListener("keydown", enterPrompt, true);
    doc.addEventListener("pointerdown", dismissPrompt, true);
    caption.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.disabled = !editor.options.editable;
    add.disabled = input.disabled;
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
      destroy: () => {
        doc.removeEventListener("pointerdown", dismissPrompt, true);
        view.dom.removeEventListener("keydown", enterPrompt, true);
      },
    };
  };
