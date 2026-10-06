import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const runFrames = (lang: Lang) => sceneDuration(cap(lang).run, 90);

export const Run: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.run} steps={cap(lang).run} />
);
