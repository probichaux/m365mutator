import { Text, Title2, tokens } from '@fluentui/react-components';

export default function TargetsPage() {
  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>Targets</Title2>
      <div style={{
        background: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: 8,
        padding: 24,
      }}>
        <Text size={300} block style={{ marginBottom: 12 }}>
          Manage the users, mailboxes, and SharePoint sites that the Users, Mail, Calendar, and Files
          tabs act on.
        </Text>
        <Text weight="semibold" block style={{ marginBottom: 8 }}>Planned functionality</Text>
        <ul style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
          <li style={{ marginBottom: 4 }}>Look up a user or mailbox by UPN or object ID</li>
          <li style={{ marginBottom: 4 }}>Look up a SharePoint site by URL or ID</li>
          <li style={{ marginBottom: 4 }}>Save frequently used targets for quick reuse across tabs</li>
        </ul>
      </div>
    </div>
  );
}
