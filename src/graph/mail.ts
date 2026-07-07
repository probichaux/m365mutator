import { getGraphClient } from './graph-client.js';

export interface MailMessage {
  subject: string;
  body: { contentType: 'Text' | 'HTML'; content: string };
  toRecipients: { emailAddress: { address: string } }[];
}

export interface MailRef {
  id: string;
  subject?: string;
}

const seg = (v: string) => encodeURIComponent(v);
const asRecipients = (addresses: string[]) =>
  addresses.map(address => ({ emailAddress: { address } }));

/** Requires the Mail.Send application permission. Sends as `userId`'s mailbox. */
export async function sendMail(userId: string, message: MailMessage): Promise<void> {
  await getGraphClient().api(`/users/${seg(userId)}/sendMail`).post({ message, saveToSentItems: true });
}

/** Requires the Mail.ReadWrite application permission. */
export async function replyToMail(userId: string, messageId: string, comment: string): Promise<void> {
  await getGraphClient().api(`/users/${seg(userId)}/messages/${seg(messageId)}/reply`).post({ comment });
}

/** Forward a message unmodified to one or more recipients. Requires Mail.ReadWrite (+ Mail.Send). */
export async function forwardMail(userId: string, messageId: string, addresses: string[], comment = ''): Promise<void> {
  await getGraphClient()
    .api(`/users/${seg(userId)}/messages/${seg(messageId)}/forward`)
    .post({ comment, toRecipients: asRecipients(addresses) });
}

/** Move a message to a folder (well-known id such as `deleteditems`). Requires Mail.ReadWrite. */
export async function moveMessage(userId: string, messageId: string, destinationId: string): Promise<void> {
  await getGraphClient()
    .api(`/users/${seg(userId)}/messages/${seg(messageId)}/move`)
    .post({ destinationId });
}

/** List up to `top` messages in a user's Inbox (id + subject only). Requires Mail.ReadWrite. */
export async function listInboxMessages(userId: string, top = 50): Promise<MailRef[]> {
  const res = await getGraphClient()
    .api(`/users/${seg(userId)}/mailFolders/inbox/messages`)
    .select('id,subject')
    .top(top)
    .get();
  return (res.value ?? []) as MailRef[];
}
