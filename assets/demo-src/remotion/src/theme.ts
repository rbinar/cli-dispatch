import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';
import {loadFont as loadSans} from '@remotion/google-fonts/Inter';

// claude.dev palette — same tokens as the setup form (scripts/setup-form.mjs).
export const colors = {
  bg: '#141413',
  panel: '#1c1b19',
  border: '#3a3935',
  text: '#faf9f5',
  dim: '#a3a29c',
  accent: '#d97757',
  green: '#8cc98f',
  red: '#e5806f',
};

export const mono = loadMono('normal', {weights: ['400', '700'], subsets: ['latin', 'latin-ext']}).fontFamily;
export const sans = loadSans('normal', {weights: ['400', '600', '800'], subsets: ['latin']}).fontFamily;

export const FPS = 30;
export const FADE = 12;
