// theditor in a node: the Tiptap core of theditor (swamikk's formatted message editor), with
// lodeflow's Edit-mode keys (↵ paragraph, ⇧↵ soft return, ⇧⌘↵ or Esc saves), ⌘↵ for
// theditor's toggle block control, images pasted, dropped or picked in as inline thumbs, and
// theditor's magnets (its formatting toolbar and a picture's Style, Alignment and Tweak) from the
// shared vanilla renderer, the same source the swamikk composer's React magnets read.
import { Editor, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { NodeEditorFactory } from '../node-editor';
import { docFromEditor, docFromWording, wordingFromDoc } from './vendor/doc';
import { formattedExtensions } from './vendor/extensions';
import { isFormattedImageSrc } from './vendor/formatted-message';
import { mountMagnets, type Magnets } from './vendor/theditor/vanilla/index';
import { ICON_URLS } from './vendor/theditor/icons';

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

/** Each image file becomes an inline image at the caret (or at `at`, where it was dropped). */
function imageInserter(editor: () => Editor | null) {
  return async (files: File[], at: number | null) => {
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
}

/** Paste or drop image files: each becomes an inline image at the caret (or where it was dropped). */
function imageInput(insert: ReturnType<typeof imageInserter>) {
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

/** The diagram is drawn dark (its theme, or the system's when it follows it): the magnets follow. */
function drawnDark(host: HTMLElement): boolean {
  const flow = (host.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
  const theme = flow?.getAttribute('theme');
  if (theme === 'dark' || theme === 'blueprint') return true;
  if (theme === 'light') return false;
  return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** A file picker for the Image magnet (⌃⌥⌘I): every chosen picture lands at the caret. */
function imagePicker(parent: HTMLElement, insert: ReturnType<typeof imageInserter>) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.hidden = true;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])].filter((f) => f.type.startsWith('image/'));
    input.value = '';
    void insert(files, null);
  });
  parent.append(input);
  return () => input.click();
}

export const theditor: NodeEditorFactory = ({ host, initial, placeholder, label, hooks }) => {
  const el = document.createElement('div');
  el.className = 'fm-ed';
  el.dataset.ph = placeholder;
  host.append(el);
  let editor: Editor | null = null;
  let magnets: Magnets | null = null;
  const insert = imageInserter(() => editor);
  // fm-empty, not empty: the diagram's own .empty is its empty-canvas hint (absolute, centred, padded),
  // which squeezed an empty node's editor to no width at all.
  const syncEmpty = () => el.classList.toggle('fm-empty', !!editor?.isEmpty);
  editor = new Editor({
    element: el,
    // The base stylesheet goes into the diagram's shadow root (styles.ts), not the page's head.
    injectCSS: false,
    extensions: [...formattedExtensions(), imageInput(insert)],
    content: docFromWording(initial.text, initial.content ? { kind: 'formatted', doc: initial.content } : undefined),
    editorProps: {
      attributes: { class: 'fm', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'true' },
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
          // ⌘↵ is theditor's toggle block control in every tool that embeds it (Al, 2026-10-24): it
          // ticks or unticks the line's to-do, or opens or closes its toggle. The editor's keys win
          // while editing, so a line with neither keeps ⌘↵ to itself: no save, no new node.
          event.preventDefault();
          editor?.commands.toggleBlockControl();
          return true;
        }
        // The magnets' chords (formatting, a picture's ⌃⌥⌘S/L/T) and Tab into the toolbar.
        if (magnets?.handleEditorKey(event)) return true;
        if (hooks.onKeydown(event)) return true;
        return false;
      },
    },
    onUpdate: () => {
      syncEmpty();
      hooks.onInput();
    },
  });
  syncEmpty();
  const live = editor;
  // This includes embedded caption controls, whose own blur does not emit
  // ProseMirror's editor blur event. A move inside the editor keeps it open.
  let finishing = false;
  const leave = (event: FocusEvent) => {
    if (live.isDestroyed || finishing) return;
    const next = event.relatedTarget as Node | null;
    if (!el.contains(next) && !magnets?.contains(next)) hooks.onBlur();
  };
  el.addEventListener('focusout', leave);
  // Caption fields and magnet forms are outside ProseMirror's key handler.
  // The host's finish chord still leaves the whole node editor from either.
  const finishKey = (event: KeyboardEvent) => {
    if (!event.isComposing && event.key === 'Enter' && event.shiftKey &&
        (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      // Submit a tuner's typed value before tearing its form down.
      const target = event.target as HTMLElement;
      finishing = true;
      try {
        if (target.matches('input, textarea, select')) target.blur();
        hooks.onKeydown(event);
      } finally {
        finishing = false;
      }
      event.stopPropagation();
    }
  };
  el.addEventListener('keydown', finishKey, true);
  const layer = host.getRootNode() as ShadowRoot | Document;
  let pick: (() => void) | null = null;
  magnets = mountMagnets({
    editor: live,
    layer: layer instanceof Document ? layer.body : layer,
    // Floated above the node's painted box, not its text box.
    anchor: () => (host.closest('.node') as HTMLElement | null) ?? host,
    // The diagram's own floating magnets (its puck, say) keep their place; the toolbar keeps clear.
    avoid: () => [...(layer as ParentNode).querySelectorAll<HTMLElement>('.ui.magnet')].filter((m) => !m.hidden && m.offsetParent).map((m) => m.getBoundingClientRect()),
    skin: { iconUrl: (name) => ICON_URLS[name] ?? '' },
    pickImage: () => pick?.(),
    dark: () => drawnDark(host),
    onLeave: () => { if (!finishing) hooks.onBlur(); },
  });
  magnets.root.addEventListener('keydown', finishKey, true);
  pick = imagePicker(magnets.root, insert);
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
    // The keyboard in a magnet is still editing this node.
    hasFocus: () => !live.isDestroyed && (live.view.hasFocus() || el.contains((layer as ShadowRoot | Document).activeElement) || !!magnets?.contains((layer as ShadowRoot | Document).activeElement)),
    destroy: () => {
      el.removeEventListener('focusout', leave);
      el.removeEventListener('keydown', finishKey, true);
      magnets?.root.removeEventListener('keydown', finishKey, true);
      magnets?.destroy();
      live.destroy();
    },
  };
};
