import { useTranslation } from 'react-i18next';
import {
  Menu, MenuTrigger, MenuButton, MenuPopover, MenuList, MenuItemRadio,
} from '@fluentui/react-components';

const LANGUAGES = [
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська' },
] as const;

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ||
    LANGUAGES.find((l) => i18n.language.startsWith(l.code)) ||
    LANGUAGES[0];

  return (
    <Menu
      checkedValues={{ lang: [currentLang.code] }}
      onCheckedValueChange={(_e, data) => i18n.changeLanguage(data.checkedItems[0])}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton appearance="subtle" aria-label={currentLang.name} style={{ fontSize: 18 }}>
          {currentLang.flag}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {LANGUAGES.map((lang) => (
            <MenuItemRadio
              key={lang.code}
              name="lang"
              value={lang.code}
              icon={<span style={{ fontSize: 18, lineHeight: 1 }}>{lang.flag}</span>}
            >
              {lang.name}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
