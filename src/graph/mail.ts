import { getGraphClient } from './graph-client.js';

export interface MailMessage {
  subject: string;
  body: { contentType: 'Text' | 'HTML'; content: string };
  toRecipients: { emailAddress: { address: string } }[];
}

/** Requires the Mail.Send application permission. Sends as `userId`'s mailbox. */
export async function sendMail(userId: string, message: MailMessage): Promise<void> {
  await getGraphClient().api(`/users/${userId}/sendMail`).post({ message, saveToSentItems: true });
}

/** Requires the Mail.ReadWrite application permission. */
export async function replyToMail(userId: string, messageId: string, comment: string): Promise<void> {
  await getGraphClient().api(`/users/${userId}/messages/${messageId}/reply`).post({ comment });
}
