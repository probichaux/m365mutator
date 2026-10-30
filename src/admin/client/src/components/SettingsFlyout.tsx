import {
  OverlayDrawer, DrawerHeader, DrawerHeaderTitle, DrawerBody,
  Button, Text, Label, Input,
  RadioGroup, Radio, Spinner, tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
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
  openRouterApiKey: string;
  openRouterModel: string;
  agentBlueprintId: string;
  agentId: string;
  agentName: string;
  agentCredentialType: AgentCredentialType;
  agentClientSecret: string;
  agentCertificatePath: string;
  agentManagedIdentityClientId: string;
}

type AgentCredentialType = 'secret' | 'certificate' | 'managedIdentity';

export default function SettingsFlyout({ open, onClose }: SettingsFlyoutProps) {
  const { t } = useTranslation('settings');
  const showToast = useToast();

  const [authMethod, setAuthMethod] = useState<'secret' | 'cert'>('secret');
  const [graphTenantId, setGraphTenantId] = useState('');
  const [graphClientId, setGraphClientId] = useState('');
  const [graphClientSecret, setGraphClientSecret] = useState('');
  const [graphCertPath, setGraphCertPath] = useState('');
  const [graphCertPassword, setGraphCertPassword] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModel, setOpenRouterModel] = useState('');
  const [agentBlueprintId, setAgentBlueprintId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentCredentialType, setAgentCredentialType] = useState<AgentCredentialType>('secret');
  const [agentClientSecret, setAgentClientSecret] = useState('');
  const [agentCertPath, setAgentCertPath] = useState('');
  const [agentMiClientId, setAgentMiClientId] = useState('');

  const [testing, setTesting] = useState(false);
  const [testingAgent, setTestingAgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);
  const agentCertInputRef = useRef<HTMLInputElement>(null);

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
    if (c.openRouterApiKey) setOpenRouterApiKey(c.openRouterApiKey);
    if (c.openRouterModel) setOpenRouterModel(c.openRouterModel);
    if (c.agentBlueprintId) setAgentBlueprintId(c.agentBlueprintId);
    if (c.agentId) setAgentId(c.agentId);
    if (c.agentName) setAgentName(c.agentName);
    if (c.agentCredentialType) setAgentCredentialType(c.agentCredentialType);
    if (c.agentClientSecret) setAgentClientSecret(c.agentClientSecret);
    if (c.agentCertificatePath) setAgentCertPath(c.agentCertificatePath);
    if (c.agentManagedIdentityClientId) setAgentMiClientId(c.agentManagedIdentityClientId);
  }, []);

  useEffect(() => {
    if (open) loadSettings();
  }, [open, loadSettings]);

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

  const testAgentToken = async () => {
    setTestingAgent(true);
    const result = await api<{ success: boolean; error?: string; latencyMs?: number; roles?: string[] }>(
      'POST', '/api/test-agent', {
        graphTenantId, agentBlueprintId, agentId, agentCredentialType,
        agentClientSecret: agentClientSecret === '********' ? '' : agentClientSecret,
        agentCertificatePath: agentCertPath, agentManagedIdentityClientId: agentMiClientId,
      });
    setTestingAgent(false);

    if (result.data.success) {
      const roles = result.data.roles?.length ? result.data.roles.join(', ') : t('agent.noRoles');
      showToast(t('toast.agentTokenSuccess', { latencyMs: result.data.latencyMs || 0, roles }), 'success');
    } else {
      showToast(t('toast.agentTokenFailed', { error: result.data.error || 'Unknown error' }), 'error');
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

    if (openRouterApiKey && openRouterApiKey !== '********') payload.openRouterApiKey = openRouterApiKey;
    if (openRouterModel) payload.openRouterModel = openRouterModel;

    if (agentBlueprintId) payload.agentBlueprintId = agentBlueprintId;
    if (agentId) payload.agentId = agentId;
    if (agentName) payload.agentName = agentName;
    payload.agentCredentialType = agentCredentialType;
    if (agentClientSecret && agentClientSecret !== '********') payload.agentClientSecret = agentClientSecret;
    if (agentMiClientId) payload.agentManagedIdentityClientId = agentMiClientId;

    const result = await api<{ success: boolean; error?: string }>('PUT', '/api/config', payload);
    setSaving(false);

    if (result.data.success) {
      showToast(t('toast.configurationSaved'), 'success');
    } else {
      showToast(result.data.error || t('toast.saveFailed'), 'error');
    }
  };

  const uploadCert = async (file: File, target: 'graph' | 'agent' = 'graph') => {
    const form = new FormData();
    form.append('certificate', file);
    const url = target === 'agent' ? '/api/upload-certificate?target=agent' : '/api/upload-certificate';
    const result = await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' });
    const data = await result.json();
    if (data.success) {
      (target === 'agent' ? setAgentCertPath : setGraphCertPath)(data.filename);
      showToast(t('toast.certificateUploaded'), 'success');
    } else {
      showToast(data.error || t('toast.uploadFailed'), 'error');
    }
  };

  const sectionStyle = { marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` };
  const fieldStyle = { marginBottom: 12 };

  return (
    <OverlayDrawer
      position="end"
      open={open}
      onOpenChange={(_e, data) => { if (!data.open) onClose(); }}
      style={{ width: 560, maxWidth: '90vw' }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" aria-label={t('common:close')}
              icon={<Dismiss24Regular />} onClick={onClose} />
          }
        >
          {t('title')}
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody>

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

          {/* Agent 365 agent identity — optional; see plans/mod07-agent.md Decision 6 */}
          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{t('agent.sectionTitle')}</Text>
            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: 12 }}>
              {t('agent.description')}
            </Text>
            <div style={fieldStyle}>
              <Label size="small">{t('agent.blueprintId')}</Label>
              <Input value={agentBlueprintId} onChange={(_, d) => setAgentBlueprintId(d.value)}
                style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
            </div>
            <div style={fieldStyle}>
              <Label size="small">{t('agent.agentId')}</Label>
              <Input value={agentId} onChange={(_, d) => setAgentId(d.value)}
                style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
            </div>
            <div style={fieldStyle}>
              <Label size="small">{t('agent.agentName')}</Label>
              <Input value={agentName} onChange={(_, d) => setAgentName(d.value)} style={{ width: '100%' }} />
            </div>
            <div style={fieldStyle}>
              <Label size="small">{t('agent.credentialType')}</Label>
              <RadioGroup value={agentCredentialType}
                onChange={(_, d) => setAgentCredentialType(d.value as AgentCredentialType)}>
                <Radio value="secret" label={t('agent.credentialSecret')} />
                <Radio value="certificate" label={t('agent.credentialCert')} />
                <Radio value="managedIdentity" label={t('agent.credentialManagedIdentity')} />
              </RadioGroup>
            </div>
            {agentCredentialType === 'secret' && (
              <div style={fieldStyle}>
                <Label size="small">{t('agent.clientSecret')}</Label>
                <Input type="password" value={agentClientSecret} onChange={(_, d) => setAgentClientSecret(d.value)}
                  placeholder="********" style={{ width: '100%' }} />
              </div>
            )}
            {agentCredentialType === 'certificate' && (
              <div style={fieldStyle}>
                <Label size="small">{t('agent.certificate')}</Label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input value={agentCertPath} readOnly placeholder={t('graph.certificateNotUploaded')}
                    style={{ flex: 1, fontFamily: 'var(--fontFamilyMonospace)' }} />
                  <Button appearance="outline" onClick={() => agentCertInputRef.current?.click()}>{t('graph.uploadPem')}</Button>
                  <input ref={agentCertInputRef} type="file" accept=".pem" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { uploadCert(f, 'agent'); e.target.value = ''; } }} />
                </div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('agent.certificateHint')}</Text>
              </div>
            )}
            {agentCredentialType === 'managedIdentity' && (
              <div style={fieldStyle}>
                <Label size="small">{t('agent.managedIdentityClientId')}</Label>
                <Input value={agentMiClientId} onChange={(_, d) => setAgentMiClientId(d.value)}
                  style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('agent.managedIdentityClientIdHint')}</Text>
              </div>
            )}
            <Button appearance="outline" onClick={testAgentToken} disabled={testingAgent}>
              {testingAgent ? <><Spinner size="tiny" /> {t('graph.verifying')}</> : t('agent.testToken')}
            </Button>
          </div>

          {/* OpenRouter — random text generation for mail mutations */}
          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{t('openRouter.sectionTitle')}</Text>
            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: 12 }}>
              {t('openRouter.description')}
            </Text>
            <div style={fieldStyle}>
              <Label size="small">{t('openRouter.apiKey')}</Label>
              <Input type="password" value={openRouterApiKey} onChange={(_, d) => setOpenRouterApiKey(d.value)}
                placeholder="********" style={{ width: '100%' }} />
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('openRouter.apiKeyHint')}</Text>
            </div>
            <div style={fieldStyle}>
              <Label size="small">{t('openRouter.model')}</Label>
              <Input value={openRouterModel} onChange={(_, d) => setOpenRouterModel(d.value)}
                placeholder="openai/gpt-4o-mini"
                style={{ width: '100%', fontFamily: 'var(--fontFamilyMonospace)' }} />
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('openRouter.modelHint')}</Text>
            </div>
          </div>

          <div>
            <Button appearance="primary" onClick={saveConfig} disabled={saving}>
              {saving ? t('savingConfiguration') : t('saveConfiguration')}
            </Button>
          </div>

      </DrawerBody>
    </OverlayDrawer>
  );
}
