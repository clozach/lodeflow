// lodeflow's stand-in for the `@courselit/common-models` package that the vendored files import (the
// sync script rewrites that import to this file). It is lodeflow's own, not a vendored copy: the
// formatted message model and the design roles (both vendored), plus the one conversation type doc.ts names.
import type { FormattedDoc } from './formatted-message';

export * from './formatted-message';
export * from './design-measurements';

/** A message's body beyond its text, as the canonical repository's conversation model names it. */
export type ConversationMessageContent = { kind: 'html'; html: string } | { kind: 'formatted'; doc: FormattedDoc };
