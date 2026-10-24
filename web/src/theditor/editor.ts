// theditor in a node: the Tiptap core of theditor (swamikk's formatted message editor), with
// lodeflow's Edit-mode keys (↵ saves, ⇧↵ a new paragraph or list item, Esc saves), ⌘↵ for
// theditor's toggle block control, and images pasted or dropped in as inline thumbs.
import { Editor, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { NodeEditorFactory } from '../node-editor';
import { docFromEditor, docFromWording, wordingFromDoc } from './vendor/doc';
import { formattedExtensions } from './vendor/extensions';
import { isFormattedImageSrc } from './vendor/formatted-message';

/** Longest side of an inline image, in pixels, after a paste or drop. */
export const IMAGE_MAX_SIDE = 1024;

const imageFiles = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'));

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * An image file as inline data: downscaled on a canvas to at most IMAGE_MAX_SIDE pixels on its long
 * side, as WebP (PNG where the browser cannot encode WebP). Null when it cannot be read.
 */
export async function imageData(file: Blob, maxSide = IMAGE_MAX_SIDE): Promise<string | null> {
  let image;
  try {
    image = await decode(file);
  } catch {
    return null;
  }
  try {
    if (!image.w || !image.h) return null;
    const scale = Math.min(1, maxSide / Math.max(image.w, image.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.w * scale));
    canvas.height = Math.max(1, Math.round(image.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    let src = canvas.toDataURL('image/webp', 0.86);
    if (!src.startsWith('data:image/webp')) src = canvas.toDataURL('image/png');
    return isFormattedImageSrc(src) ? src : null;
  } finally {
    image.close();
  }
}

/** Paste or drop image files: each becomes an inline image at the caret (or where it was dropped). */
function imageInput(editor: () => Editor | null) {
  const insert = async (files: File[], at: number | null) => {
    for (const file of files) {
      const src = await imageData(file);
      const live = editor();
      if (!src || !live || live.isDestroyed) continue;
      // The editor's own command: the image at the caret, the caret after it.
      if (at === null) live.chain().setImage({ src }).run();
      else {
        live.chain().setTextSelection(Math.min(at, live.state.doc.content.size)).setImage({ src }).run();
        at = live.state.selection.from;
      }
    }
  };
  return Extension.create({
    name: 'lodeflowImageInput',
    addProseMirrorPlugins: () => [
      new Plugin({
        props: {
          handlePaste: (_view: EditorView, event: ClipboardEvent) => {
            const files = imageFiles(event.clipboardData);
            if (!files.length) return false;
            event.preventDefault();
            void insert(files, null);
            return true;
          },
          handleDrop: (view: EditorView, event: DragEvent, _slice, moved: boolean) => {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            void insert(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null);
            return true;
          },
        },
      }),
    ],
  });
}

export const theditor: NodeEditorFactory = ({ host, initial, placeholder, label, hooks }) => {
  const el = document.createElement('div');
  el.className = 'fm-ed';
  el.dataset.ph = placeholder;
  host.append(el);
  let editor: Editor | null = null;
  let passThrough = false;
  // fm-empty, not empty: the diagram's own .empty is its empty-canvas hint (absolute, centred, padded),
  // which squeezed an empty node's editor to no width at all.
  const syncEmpty = () => el.classList.toggle('fm-empty', !!editor?.isEmpty);
  editor = new Editor({
    element: el,
    // The base stylesheet goes into the diagram's shadow root (styles.ts), not the page's head.
    injectCSS: false,
    extensions: [...formattedExtensions(), imageInput(() => editor)],
    content: docFromWording(initial.text, initial.content ? { kind: 'formatted', doc: initial.content } : undefined),
    editorProps: {
      attributes: { class: 'fm', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'true' },
      handleKeyDown: (view, event) => {
        if (passThrough || event.isComposing) return false;
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey) {
          // ⌘↵ is theditor's toggle block control in every tool that embeds it (Al, 2026-10-24): it
          // ticks or unticks the line's to-do, or opens or closes its toggle. The editor's keys win
          // while editing, so a line with neither keeps ⌘↵ to itself: no save, no new node.
          event.preventDefault();
          editor?.commands.toggleBlockControl();
          return true;
        }
        if (hooks.onKeydown(event)) return true;
        if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          // ↵ saves, so ⇧↵ does what ↵ does in the editor: a new paragraph, list item or code line.
          const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
          passThrough = true;
          try {
            view.someProp('handleKeyDown', (f) => f(view, enter));
          } finally {
            passThrough = false;
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: () => {
      syncEmpty();
      hooks.onInput();
    },
    onBlur: () => hooks.onBlur(),
  });
  syncEmpty();
  const live = editor;
  return {
    el,
    focus: () => live.view.focus(),
    selectAll: () => {
      live.commands.selectAll();
    },
    value: () => {
      const wording = wordingFromDoc(docFromEditor(live.getJSON()));
      return { text: wording.text, content: wording.content?.doc };
    },
    hasFocus: () => !live.isDestroyed && live.view.hasFocus(),
    destroy: () => live.destroy(),
  };
};
