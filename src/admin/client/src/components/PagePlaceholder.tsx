import { Text, Title2, tokens } from '@fluentui/react-components';

interface PagePlaceholderProps {
  title: string;
  permission: string;
  operations: string[];
}

export default function PagePlaceholder({ title, permission, operations }: PagePlaceholderProps) {
  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{title}</Title2>
      <div style={{
        background: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: 8,
        padding: 24,
      }}>
        <Text size={300} block style={{ marginBottom: 12 }}>
          Requires the Graph application permission <Text weight="semibold" font="monospace">{permission}</Text>.
        </Text>
        <Text weight="semibold" block style={{ marginBottom: 8 }}>Planned operations</Text>
        <ul style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
          {operations.map(op => <li key={op} style={{ marginBottom: 4 }}>{op}</li>)}
        </ul>
      </div>
    </div>
  );
}
