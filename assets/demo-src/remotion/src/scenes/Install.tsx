import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const installFrames = (lang: Lang) => sceneDuration(cap(lang).install, 75);

export const Install: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.install} steps={cap(lang).install} />
);
