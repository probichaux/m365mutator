import { Button, Text, tokens } from '@fluentui/react-components';
import { useEffect } from 'react';

interface HelpFlyoutProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpFlyout({ open, onClose }: HelpFlyoutProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sectionStyle = { marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, animation: 'fadeIn 0.15s ease' }}
    >
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '90vw',
        background: tokens.colorNeutralBackground1, boxShadow: tokens.shadow64,
        display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.2s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        }}>
          <Text weight="semibold" size={500}>Help</Text>
          <Button appearance="subtle" onClick={onClose} style={{ fontSize: 20, minWidth: 32 }}>&times;</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>About M365Mutator</Text>
            <Text size={300} block>
              M365Mutator connects to a Microsoft 365 tenant via Microsoft Graph and lets an operator
              update users, send/reply to mail, manage calendar items, and manage OneDrive/SharePoint
              documents.
            </Text>
          </div>

          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>Getting started</Text>
            <ol style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
              <li style={{ marginBottom: 4 }}>
                Open Settings and enter the Entra ID app registration&rsquo;s tenant ID, client ID, and
                a client secret or certificate.
              </li>
              <li style={{ marginBottom: 4 }}>Use Verify Graph Connection to confirm the credentials work.</li>
              <li style={{ marginBottom: 4 }}>Use Targets to choose which users, mailboxes, or sites to act on.</li>
              <li>Use the Users, Mail, Calendar, and Files tabs to run mutations against those targets.</li>
            </ol>
          </div>

          <div>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>Required Graph permissions</Text>
            <Text size={300} block style={{ color: tokens.colorNeutralForeground2 }}>
              Each tab lists the application permission it needs. Grant only what you plan to use, and
              have a tenant admin consent to it in the Entra ID app registration.
            </Text>
          </div>

        </div>
      </div>
    </div>
  );
}
