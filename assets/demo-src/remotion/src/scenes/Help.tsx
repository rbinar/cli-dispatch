import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const HELP_FRAMES = sceneDuration(captures.help, 75);

export const Help: React.FC = () => (
  <TerminalScene
    step="08 · Reference"
    title="Help"
    subtitle="the whole surface"
    steps={captures.help} fontSize={19}
  />
);
