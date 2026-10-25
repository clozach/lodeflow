// lodeflow/theditor — formatted text in nodes. Importing this module (after lodeflow) registers
// theditor (the editor of swamikk's comments) for <lode-flow> nodes: Markdown-style typing becomes
// formatting, pasted or dropped images become inline thumbs, and nodes with formatted content draw it.
import { LodeFlowElement } from '../index';
import type { NodeEditorKit } from '../node-editor';
import { theditor, imageData, IMAGE_MAX_SIDE } from './editor';
import { formattedSchema, renderFormatted } from './render';
import { MAGNETS_CSS, THEDITOR_CSS } from './styles';
import { IMAGE_CSS } from './vendor/image-css';
import { CHROME_CSS } from './vendor/theditor/chrome-css';
import { FIELD_CSS, HOST_CSS } from './vendor/theditor/vanilla/index';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl+';

/** What theditor adds to Help. */
export const THEDITOR_HELP: [string, string][] = [
  ['*words* or **words**', 'Bold'],
  ['_words_', 'Italic'],
  ['`words`', 'Code'],
  [`${MOD}B · ${MOD}I · ${MOD}E`, 'Bold · italic · code for the selected words'],
  ['# ', 'Heading, at the start of a line (## to #### for smaller ones)'],
  ['- ', 'Bulleted list, at the start of a line'],
  ['1. ', 'Numbered list, at the start of a line'],
  ['- [ ] ', 'To-do, at the start of a line'],
  ['>v ', 'Toggle, at the start of a line: a summary line over what it opens to'],
  ['> ', 'Quote, at the start of a line'],
  ['--- ', 'Hair line, at the start of a line'],
  ['[words](https://…)', 'Link the words to the address'],
  ['↵ · ⇧↵', 'New paragraph or list item · soft return within the line'],
  [`⇧${MOD}↵`, 'Save and finish editing the selected item'],
  [`${MOD}↵`, 'Tick or untick a to-do, open or close a toggle'],
  ['Paste or drop an image', 'Adds it in the line as a thumb, a third of the node’s width; three fit side by side; Tweak › width offers 1/3, 2/3 and 3/3'],
  ['Tab', 'The formatting magnets above the node (← → between them; Tab again a selected picture’s magnets)'],
  ['⌃⌥⌘S · ⌃⌥⌘L · ⌃⌥⌘T', 'A selected picture’s Style, Alignment and Tweak (⌃⌥⌘T makes a toggle otherwise)'],
];

/** The kit `LodeFlowElement.registerNodeEditor` takes: editor, node drawing, styles and Help rows. */
export const theditorKit: NodeEditorKit = {
  create: theditor,
  render: renderFormatted,
  css: IMAGE_CSS + THEDITOR_CSS + CHROME_CSS + FIELD_CSS + HOST_CSS + MAGNETS_CSS,
  help: THEDITOR_HELP,
};

LodeFlowElement.registerNodeEditor(theditorKit);

export { theditor, formattedSchema, imageData, IMAGE_MAX_SIDE, renderFormatted };
export { IMAGE_CSS } from './vendor/image-css';
export { formattedText, parseFormattedDoc, isFormattedImageSrc, parseImageStyle } from './vendor/formatted-message';
export type { FormattedDoc, FormattedImage, FormattedImageAttrs } from './vendor/formatted-message';
