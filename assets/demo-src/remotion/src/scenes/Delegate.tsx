import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const DELEGATE_FRAMES = sceneDuration(captures.agent, 120);

export const Delegate: React.FC = () => (
  <TerminalScene
    step="04 · Delegate"
    title="Just ask Claude"
    subtitle="the runner agent delegates and verifies"
    steps={captures.agent}
  />
);
