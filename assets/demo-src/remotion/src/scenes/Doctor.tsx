import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const doctorFrames = (lang: Lang) => sceneDuration(cap(lang).doctor, 60);

export const Doctor: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.doctor} steps={cap(lang).doctor} />
);
