import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Spinner, Switch, Text, Textarea, Title2, Tooltip, tokens,
} from '@fluentui/react-components';
import {
  CheckmarkRegular, CheckmarkCircle20Filled, DismissCircle20Filled, CloudArrowDownRegular,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';

const CATEGORIES = ['identities', 'mail', 'calendar', 'onedrive', 'sharepoint'] as const;
type Category = (typeof CATEGORIES)[number];

interface CategoryTargets {
  enabled: boolean;
  items: string[];
}

interface CheckResult {
  item: string;
  ok: boolean;
  error?: string;
}

interface CategoryState {
  enabled: boolean;
  text: string;
  checking: boolean;
  loading: boolean;
  results: CheckResult[] | null;
}

const emptyState = (): CategoryState => ({ enabled: false, text: '', checking: false, loading: false, results: null });

function textToItems(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l !== '');
}

/** Pull every non-empty cell out of a CSV file, one target per cell. */
function parseCsv(content: string): string[] {
  return content
    .split(/\r?\n/)
    .flatMap(line => line.split(/[,;]/))
    .map(cell => cell.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter(cell => cell !== '');
}

interface TargetsPageProps {
  /** Called after targets are successfully saved, so tab enablement can resync. */
  onSaved?: () => void;
}

export default function TargetsPage({ onSaved }: TargetsPageProps) {
  const { t } = useTranslation('targets');
  const showToast = useToast();

  const [state, setState] = useState<Record<Category, CategoryState>>(() =>
    Object.fromEntries(CATEGORIES.map(c => [c, emptyState()])) as Record<Category, CategoryState>);
  const [saving, setSaving] = useState(false);
  const fileInputRefs = useRef<Partial<Record<Category, HTMLInputElement | null>>>({});

  useEffect(() => {
    api<Record<Category, CategoryTargets>>('GET', '/api/targets').then(r => {
      if (r.status !== 200) return;
      setState(prev => {
        const next = { ...prev };
        for (const c of CATEGORIES) {
          const loaded = r.data[c];
          if (loaded) next[c] = { ...prev[c], enabled: loaded.enabled, text: loaded.items.join('\n') };
        }
        return next;
      });
    });
  }, []);

  const update = (category: Category, patch: Partial<CategoryState>) => {
    setState(prev => ({ ...prev, [category]: { ...prev[category], ...patch } }));
  };

  const buildPayload = (src: Record<Category, CategoryState>) =>
    Object.fromEntries(CATEGORIES.map(c => [c, {
      enabled: src[c].enabled,
      items: textToItems(src[c].text),
    }]));

  // Enable/disable is a first-class independent action: persist it right away
  // and let the tab bar resync via onSaved, instead of waiting for the Save
  // button (which is only needed to commit edits to the item lists).
  const toggleEnabled = async (category: Category, checked: boolean) => {
    const next = { ...state, [category]: { ...state[category], enabled: checked } };
    setState(next);
    const result = await api<{ success: boolean; error?: string }>('PUT', '/api/targets', buildPayload(next));
    if (result.data.success) {
      onSaved?.();
    } else {
      showToast(result.data.error || t('toast.saveFailed'), 'error');
      setState(state); // revert the optimistic toggle
    }
  };

  const importCsv = (category: Category, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const items = parseCsv(String(reader.result ?? ''));
      if (items.length === 0) {
        showToast(t('toast.csvEmpty'), 'warning');
        return;
      }
      setState(prev => {
        const existing = textToItems(prev[category].text);
        return {
          ...prev,
          [category]: {
            ...prev[category],
            text: [...existing, ...items].join('\n'),
            results: null,
          },
        };
      });
    };
    reader.onerror = () => showToast(t('toast.csvReadFailed'), 'error');
    reader.readAsText(file);
  };

  const check = async (category: Category) => {
    const items = textToItems(state[category].text);
    if (items.length === 0) {
      showToast(t('toast.nothingToCheck'), 'warning');
      return;
    }
    update(category, { checking: true, results: null });
    const result = await api<{ results?: CheckResult[]; error?: string }>(
      'POST', '/api/targets/check', { category, items },
    );
    if (result.status === 200 && result.data.results) {
      const failed = result.data.results.filter(r => !r.ok).length;
      update(category, { checking: false, results: result.data.results });
      showToast(
        failed === 0
          ? t('toast.checkAllOk', { total: items.length })
          : t('toast.checkFailures', { failed, total: items.length }),
        failed === 0 ? 'success' : 'warning',
      );
    } else {
      update(category, { checking: false });
      showToast(result.data.error || t('toast.checkFailed'), 'error');
    }
  };

  const load = async (category: Category) => {
    update(category, { loading: true });
    const result = await api<{ items?: string[]; total?: number; truncated?: boolean; error?: string }>(
      'POST', '/api/targets/load', { category },
    );
    if (result.status === 200 && result.data.items) {
      const items = result.data.items;
      const text = items.join('\n');
      setState(prev => {
        const next = { ...prev, [category]: { ...prev[category], loading: false, text, results: null } };
        // Mail and Calendar resolve to the same mailbox users, so loading Mail
        // also fills Calendar — regardless of Calendar's enabled switch.
        if (category === 'mail') {
          next.calendar = { ...prev.calendar, text, results: null };
        }
        return next;
      });
      if (result.data.truncated) {
        showToast(t('toast.loadTruncated', { count: items.length, total: result.data.total ?? items.length }), 'warning');
      } else if (items.length === 0) {
        showToast(t('toast.loadEmpty'), 'warning');
      } else {
        showToast(t('toast.loadedCount', { count: items.length }), 'success');
      }
    } else {
      update(category, { loading: false });
      showToast(result.data.error || t('toast.loadFailed'), 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    const result = await api<{ success: boolean; error?: string }>('PUT', '/api/targets', buildPayload(state));
    setSaving(false);
    if (result.data.success) {
      showToast(t('toast.saved'), 'success');
      onSaved?.();
    } else {
      showToast(result.data.error || t('toast.saveFailed'), 'error');
    }
  };

  return (
    <div>
      <Title2 block style={{ marginBottom: 8 }}>{t('title')}</Title2>
      <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 20 }}>
        {t('description')}
      </Text>

      {CATEGORIES.map(category => {
        const s = state[category];
        return (
          <Card key={category} style={{ marginBottom: 16, opacity: s.enabled ? 1 : 0.7 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <Text weight="semibold" size={400} block>{t(`categories.${category}.label`)}</Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {t(`categories.${category}.hint`)}
                </Text>
              </div>
              <Switch
                checked={s.enabled}
                onChange={(_, d) => toggleEnabled(category, d.checked)}
                label={s.enabled ? t('enabled') : t('disabled')}
              />
            </div>

            <Textarea
              value={s.text}
              disabled={!s.enabled}
              onChange={(_, d) => update(category, { text: d.value, results: null })}
              placeholder={t(category === 'sharepoint' ? 'placeholderUrls' : 'placeholderUpns')}
              resize="vertical"
              style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)', minHeight: 192, marginTop: 8 }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Tooltip content={t('loadFromTenant')} relationship="label">
                <Button
                  appearance="outline"
                  icon={s.loading ? <Spinner size="tiny" /> : <CloudArrowDownRegular />}
                  disabled={!s.enabled || s.loading}
                  onClick={() => load(category)}
                >
                  {s.loading ? t('loading') : t('load')}
                </Button>
              </Tooltip>
              <Tooltip content={t('importCsv')} relationship="label">
                <Button
                  appearance="outline"
                  disabled={!s.enabled}
                  onClick={() => fileInputRefs.current[category]?.click()}
                >
                  {t('upload')}
                </Button>
              </Tooltip>
              <input
                ref={el => { fileInputRefs.current[category] = el; }}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { importCsv(category, f); e.target.value = ''; }
                }}
              />
              <Button
                appearance="outline"
                icon={s.checking ? <Spinner size="tiny" /> : <CheckmarkRegular />}
                disabled={!s.enabled || s.checking}
                onClick={() => check(category)}
              >
                {s.checking ? t('checking') : t('check')}
              </Button>
            </div>

            {s.results && (
              <div style={{ marginTop: 12 }}>
                {s.results.map((r, i) => (
                  <div key={`${r.item}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    {r.ok
                      ? <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />
                      : <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />}
                    <Text size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{r.item}</Text>
                    {!r.ok && r.error && (
                      <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                        {r.error === 'not found' ? t('errors.notFound')
                          : r.error === 'not a valid UPN' ? t('errors.invalidUpn')
                          : r.error === 'not a valid URL' ? t('errors.invalidUrl')
                          : r.error}
                      </Text>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <Button appearance="primary" onClick={save} disabled={saving}>
        {saving ? t('saving') : t('save')}
      </Button>
    </div>
  );
}
