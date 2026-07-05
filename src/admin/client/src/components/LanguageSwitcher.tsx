import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  makeStyles,
  tokens,
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Button,
} from '@fluentui/react-components';
import { Checkmark16Regular } from '@fluentui/react-icons';

const LANGUAGES = [
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська' },
] as const;

const useStyles = makeStyles({
  trigger: {
    minWidth: 'auto',
    padding: '6px 10px',
    fontSize: '18px',
    lineHeight: '1',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  surface: { padding: '4px', minWidth: '180px' },
  item: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
    borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
    color: tokens.colorNeutralForeground1, border: 'none', background: 'none',
    width: '100%', textAlign: 'left',
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  itemActive: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
    borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
    color: tokens.colorBrandForeground1, fontWeight: 600,
    border: 'none', background: tokens.colorBrandBackground2,
    width: '100%', textAlign: 'left',
    '&:hover': { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  flag: { fontSize: '20px', lineHeight: '1' },
  name: { flex: 1 },
  check: { color: tokens.colorBrandForeground1, flexShrink: 0 },
});

export default function LanguageSwitcher() {
  const styles = useStyles();
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ||
    LANGUAGES.find((l) => i18n.language.startsWith(l.code)) ||
    LANGUAGES[0];

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)}>
      <PopoverTrigger disableButtonEnhancement>
        <button className={styles.trigger} title={currentLang.name}>
          {currentLang.flag}
        </button>
      </PopoverTrigger>
      <PopoverSurface className={styles.surface}>
        {LANGUAGES.map((lang) => {
          const isActive = lang.code === currentLang.code;
          return (
            <Button
              key={lang.code}
              appearance="subtle"
              className={isActive ? styles.itemActive : styles.item}
              onClick={() => handleLanguageChange(lang.code)}
            >
              <span className={styles.flag}>{lang.flag}</span>
              <span className={styles.name}>{lang.name}</span>
              {isActive && <Checkmark16Regular className={styles.check} />}
            </Button>
          );
        })}
      </PopoverSurface>
    </Popover>
  );
}
