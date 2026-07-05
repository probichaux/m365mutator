import {
  Button, Text, Label, Input,
  RadioGroup, Radio, Spinner, tokens,
} from '@fluentui/react-components';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useToast } from './ToastProvider';

interface SettingsFlyoutProps {
  open: boolean;
  onClose: () => void;
}

interface ConfigData {
  graphTenantId: string;
  graphClientId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
  graphCertificatePassword: string;
}

export default function SettingsFlyout({ open, onClose }: SettingsFlyoutProps) {
  const { t } = useTranslation('settings');
  const showToast = useToast();

  const [authMethod, setAuthMethod] = useState<'secret' | 'cert'>('secret');
  const [graphTenantId, setGraphTenantId] = useState('');
  const [graphClientId, setGraphClientId] = useState('');
  const [graphClientSecret, setGraphClientSecret] = useState('');
  const [graphCertPath, setGraphCertPath] = useState('');
  const [graphCertPassword, setGraphCertPassword] = useState('');

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);

  const loadSettings = useCallback(async () => {
    const result = await api<ConfigData>('GET', '/api/config');
    const c = result.data;
    if (c.graphTenantId) setGraphTenantId(c.graphTenantId);
    if (c.graphClientId) setGraphClientId(c.graphClientId);
    if (c.graphClientSecret) setGraphClientSecret(c.graphClientSecret);
    if (c.graphCertificatePath) {
      setGraphCertPath(c.graphCertificatePath);
      setAuthMethod('cert');
    }
    if (c.graphCertificatePassword) setGraphCertPassword(c.graphCertificatePassword);
  }, []);

  useEffect(() => {
    if (open) loadSettings();
  }, [open, loadSettings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const testConnection = async () => {
    setTesting(true);
    const skipMasked = (v: string) => v === '********' ? '' : v;

    const overrides = authMethod === 'secret'
      ? { graphTenantId, graphClientId, graphClientSecret: skipMasked(graphClientSecret), graphCertificatePath: '', graphCertificatePassword: '' }
      : { graphTenantId, graphClientId, graphClientSecret: '', graphCertificatePath: graphCertPath, graphCertificatePassword: skipMasked(graphCertPassword) };

    const result = await api<{ success: boolean; error?: string; latencyMs?: number }>('POST', '/api/test-graph', overrides);
    setTesting(false);

    if (result.data.success) {
      showToast(t('toast.graphConnectionSuccess', { latencyMs: result.data.latencyMs || 0 }), 'success');
    } else {
      showToast(t('toast.graphConnectionFailed', { error: result.data.error || 'Unknown error' }), 'error');
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    const payload: Record<string, string> = {};

    if (graphTenantId) payload.graphTenantId = graphTenantId;

    if (authMethod === 'secret') {
      if (graphClientId) payload.graphClientId = graphClientId;
      if (graphClientSecret && graphClientSecret !== '********') payload.graphClientSecret = graphClientSecret;
      payload.graphCertificatePath = '';
      payload.graphCertificatePassword = '';
    } else {
      if (graphClientId) payload.graphClientId = graphClientId;
      payload.graphClientSecret = '';
      if (graphCertPath) payload.graphCertificatePath = graphCertPath;
      if (graphCertPassword && graphCertPassword !== '********') payload.graphCertificatePassword = graphCertPassword;
    }

    const result = await api<{ success: boolean; error?: string }>('PUT', '/api/config', payload);
    setSaving(false);

    if (result.data.success) {
      showToast(t('toast.configurationSaved'), 'success');
    } else {
      showToast(result.data.error || t('toast.saveFailed'), 'error');
    }
  };

  const uploadCert = async (file: File) => {
    const form = new FormData();
    form.append('certificate', file);
    const result = await fetch('/api/upload-certificate', { method: 'POST', body: form, credentials: 'same-origin' });
    const data = await result.json();
    if (data.success) {
      setGraphCertPath(data.path);
      showToast(t('toast.certificateUploaded'), 'success');
    } else {
      showToast(data.error || t('toast.uploadFailed'), 'error');
    }
  };

  if (!open) return null;

  const sectionStyle = { marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` };
  const fieldStyle = { marginBottom: 12 };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, animation: 'fadeIn 0.15s ease' }}
    >
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 560, maxWidth: '90vw',
        background: tokens.colorNeutralBackground1, boxShadow: tokens.shadow64,
        display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.2s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        }}>
          <Text weight="semibold" size={500}>{t('title')}</Text>
          <Button appearance="subtle" onClick={onClose} aria-label={t('common:close')} style={{ fontSize: 20, minWidth: 32 }}>&times;</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* Microsoft Graph / Entra ID app registration */}
          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{t('graph.sectionTitle')}</Text>
            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: 12 }}>
              {t('graph.description')}
            </Text>
            <div style={fieldStyle}>
              <Label size="small">{t('graph.tenantId')}</Label>
              <Input value={graphTenantId} onChange={(_, d) => setGraphTenantId(d.value)}
                style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('graph.tenantIdFormat')}</Text>
            </div>
            <div style={fieldStyle}>
              <Label size="small">{t('graph.authMethod')}</Label>
              <RadioGroup value={authMethod} onChange={(_, d) => setAuthMethod(d.value as 'secret' | 'cert')} layout="horizontal">
                <Radio value="secret" label={t('graph.authMethodSecret')} />
                <Radio value="cert" label={t('graph.authMethodCert')} />
              </RadioGroup>
            </div>

            {authMethod === 'secret' ? (
              <>
                <div style={fieldStyle}>
                  <Label size="small">{t('graph.clientId')}</Label>
                  <Input value={graphClientId} onChange={(_, d) => setGraphClientId(d.value)}
                    style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
                </div>
                <div style={fieldStyle}>
                  <Label size="small">{t('graph.clientSecret')}</Label>
                  <Input type="password" value={graphClientSecret} onChange={(_, d) => setGraphClientSecret(d.value)}
                    placeholder="********" style={{ width: '100%' }} />
                </div>
              </>
            ) : (
              <>
                <div style={fieldStyle}>
                  <Label size="small">{t('graph.clientId')}</Label>
                  <Input value={graphClientId} onChange={(_, d) => setGraphClientId(d.value)}
                    style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
                </div>
                <div style={fieldStyle}>
                  <Label size="small">{t('graph.certificate')}</Label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input value={graphCertPath} readOnly placeholder={t('graph.certificateNotUploaded')}
                      style={{ flex: 1, fontFamily: 'var(--fontFamilyMonospace)' }} />
                    <Button appearance="outline" onClick={() => certInputRef.current?.click()}>{t('graph.uploadPem')}</Button>
                    <input ref={certInputRef} type="file" accept=".pem,.crt,.key,.cer" hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { uploadCert(f); e.target.value = ''; } }} />
                  </div>
                </div>
                <div style={fieldStyle}>
                  <Label size="small">{t('graph.certificatePassword')}</Label>
                  <Input type="password" value={graphCertPassword} onChange={(_, d) => setGraphCertPassword(d.value)}
                    placeholder="********" style={{ width: '100%' }} />
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('graph.certificatePasswordHint')}</Text>
                </div>
              </>
            )}
            <Button appearance="outline" onClick={testConnection} disabled={testing}>
              {testing ? <><Spinner size="tiny" /> {t('graph.verifying')}</> : t('graph.verifyConnection')}
            </Button>
          </div>

          <div>
            <Button appearance="primary" onClick={saveConfig} disabled={saving}>
              {saving ? t('savingConfiguration') : t('saveConfiguration')}
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
