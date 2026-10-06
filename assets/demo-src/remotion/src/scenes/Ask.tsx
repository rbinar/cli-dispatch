import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const ASK_FRAMES = sceneDuration(captures.ask, 80);

export const Ask: React.FC = () => (
  <TerminalScene
    step="03 · Ask"
    title="Ask a worker"
    subtitle="one-shot, read-only"
    steps={captures.ask}
  />
);
