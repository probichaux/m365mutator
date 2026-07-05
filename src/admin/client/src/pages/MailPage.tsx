import PagePlaceholder from '../components/PagePlaceholder';

export default function MailPage() {
  return (
    <PagePlaceholder
      title="Mail"
      permission="Mail.ReadWrite, Mail.Send"
      operations={[
        'Send a new mail message as a mailbox',
        'Reply to an existing message',
        'Move or delete messages',
      ]}
    />
  );
}
