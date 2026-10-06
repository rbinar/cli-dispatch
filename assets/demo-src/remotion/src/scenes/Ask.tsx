import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const askFrames = (lang: Lang) => sceneDuration(cap(lang).ask, 80);

export const Ask: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.ask} steps={cap(lang).ask} />
);
