'use client'; // Next.js app router: the diagram is a client component.

// React: controlled document, undo history kept in localStorage.
import { useState } from 'react';
import { LodeFlow } from 'lodeflow/react';
import type { FlowDoc } from 'lodeflow';
import initial from '../release-slip.json';

export default function FlowDemo() {
  const [doc, setDoc] = useState<FlowDoc>(initial as FlowDoc);
  return (
    <LodeFlow
      doc={doc}
      onChange={(next) => setDoc(next)} // hand back the same object: the element ignores it
      storageKey="flow-demo" // content + undo history survive reloads
      wheel="auto" // page scroll is never trapped until the diagram is clicked
      style={{ height: 480, borderRadius: 12 }}
    />
  );
}
