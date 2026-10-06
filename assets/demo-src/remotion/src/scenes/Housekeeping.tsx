import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const housekeepingFrames = (lang: Lang) => sceneDuration(cap(lang).gain, 75);

export const Housekeeping: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.housekeeping} steps={cap(lang).gain} fontSize={26} />
);
