import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const INSTALL_FRAMES = sceneDuration(captures.install, 75);

export const Install: React.FC = () => (
  <TerminalScene
    step="01 · Install"
    title="Install"
    subtitle="two plugin commands, then setup"
    steps={captures.install}
  />
);
