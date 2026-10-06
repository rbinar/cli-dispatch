import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const helpFrames = (lang: Lang) => sceneDuration(cap(lang).help, 75);

export const Help: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.help} steps={cap(lang).help} fontSize={19} />
);
