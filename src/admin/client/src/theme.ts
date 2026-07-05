import { createLightTheme, type BrandVariants } from '@fluentui/react-components';

// M365Mutator brand palette — indigo primary with a mint-teal accent.
// The ramp runs deep indigo -> primary -> light tint.
const mutatorBrand: BrandVariants = {
  10: '#0c0a2e',
  20: '#181454',
  30: '#241d78',
  40: '#31279a',
  50: '#5B4FE9', // Primary brand color
  60: '#7166ed',
  70: '#867df1',
  80: '#9a94f4',
  90: '#adaaf7',
  100: '#c1c0f9',
  110: '#d4d5fb',
  120: '#e0e1fc',
  130: '#eceffd',
  140: '#f2f4fe',
  150: '#f8f9fe',
  160: '#fcfdff',
};

export const mutatorTheme = createLightTheme(mutatorBrand);

mutatorTheme.colorBrandBackground = '#5B4FE9';
mutatorTheme.colorBrandBackgroundHover = '#4A3FCB';
mutatorTheme.colorBrandBackgroundPressed = '#241d78';
mutatorTheme.colorBrandBackgroundSelected = '#4A3FCB';
mutatorTheme.colorBrandForeground1 = '#5B4FE9';
mutatorTheme.colorBrandForeground2 = '#241d78';
mutatorTheme.colorBrandStroke1 = '#5B4FE9';
mutatorTheme.colorBrandStroke2 = '#7166ed';
mutatorTheme.colorNeutralForeground1 = '#242424';

mutatorTheme.fontFamilyBase = "'Plus Jakarta Sans', Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
mutatorTheme.fontFamilyMonospace = "'IBM Plex Mono', 'SF Mono', 'Consolas', monospace";
