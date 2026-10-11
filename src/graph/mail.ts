import { getGraphClient } from './graph-client.js';
import { recordThrottle, retryAfterSeconds } from './throttle-stats.js';

export interface MailMessage {
  subject: string;
  body: { contentType: 'Text' | 'HTML'; content: string };
  toRecipients: { emailAddress: { address: string } }[];
}

export interface MailRef {
  id: string;
  subject?: string;
  hasAttachments?: boolean;
  /** Stored size in bytes (PidTagMessageSize), when Graph returns it. */
  size?: number;
  /** MAPI message class (PidTagMessageClass), e.g. IPM.Note or IPM.Schedule.Meeting.Request. */
  messageClass?: string;
}

/** MAPI PidTagMessageSize: the item's stored size in bytes, attachments included. */
const MESSAGE_SIZE_PROP = 'Integer 0x0E08';
/** MAPI PidTagMessageClass. */
const MESSAGE_CLASS_PROP = 'String 0x001A';

/** Graph may echo a property id in another case or without zero padding ("Integer 0xe08"). */
function propTag(id: string): number {
  return parseInt(id.split(' ').pop() ?? '', 16);
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

/** List up to `top` messages in a user's Inbox, with stored sizes and message classes. Requires Mail.ReadWrite. */
export async function listInboxMessages(userId: string, top = 50): Promise<MailRef[]> {
  const res = await getGraphClient()
    .api(`/users/${seg(userId)}/mailFolders/inbox/messages`)
    .select('id,subject,hasAttachments')
    .expand(`singleValueExtendedProperties($filter=id eq '${MESSAGE_SIZE_PROP}' or id eq '${MESSAGE_CLASS_PROP}')`)
    .top(top)
    .get();
  type Raw = MailRef & { singleValueExtendedProperties?: { id: string; value: string }[] };
  return ((res.value ?? []) as Raw[]).map(({ singleValueExtendedProperties, ...m }) => {
    const ref: MailRef = { ...m };
    for (const prop of singleValueExtendedProperties ?? []) {
      const tag = propTag(prop.id);
      if (tag === propTag(MESSAGE_SIZE_PROP) && Number.isFinite(Number(prop.value))) ref.size = Number(prop.value);
      if (tag === propTag(MESSAGE_CLASS_PROP)) ref.messageClass = prop.value;
    }
    return ref;
  });
}

/** Graph accepts a file attachment inline only below 3 MB; larger ones need an upload session. */
const INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
/** Graph recommends upload ranges under 4 MB. */
const UPLOAD_CHUNK = 3 * 1024 * 1024;
const MAX_UPLOAD_RETRIES = 10;

export interface MailAttachment {
  name: string;
  contentType: string;
  bytes: Buffer;
}

/**
 * Send a message that carries a file attachment of any size up to Graph's 150 MB
 * limit: create a draft, attach the file (inline or via an upload session), then
 * send it. The draft is deleted if any step before the send fails. Requires
 * Mail.ReadWrite + Mail.Send.
 */
export async function sendMailWithAttachment(userId: string, message: MailMessage, attachment: MailAttachment): Promise<void> {
  const client = getGraphClient();
  const draft = await client.api(`/users/${seg(userId)}/messages`).post(message) as { id: string };
  const draftPath = `/users/${seg(userId)}/messages/${seg(draft.id)}`;
  try {
    if (attachment.bytes.length < INLINE_ATTACHMENT_LIMIT) {
      await client.api(`${draftPath}/attachments`).post({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.name,
        contentType: attachment.contentType,
        contentBytes: attachment.bytes.toString('base64'),
      });
    } else {
      const session = await client.api(`${draftPath}/attachments/createUploadSession`).post({
        AttachmentItem: { attachmentType: 'file', name: attachment.name, size: attachment.bytes.length },
      }) as { uploadUrl: string };
      await uploadInChunks(session.uploadUrl, attachment.bytes);
    }
  } catch (err) {
    await client.api(draftPath).delete().catch(() => undefined);
    throw err;
  }
  await client.api(`${draftPath}/send`).post({});
}

/**
 * PUT the bytes to a pre-authenticated upload URL in ordered ranges. Honors
 * Retry-After on 429/503/504, which Outlook returns once a mailbox passes its
 * upload budget (150 MB per 5 minutes), and records each one as throttling.
 */
async function uploadInChunks(uploadUrl: string, bytes: Buffer): Promise<void> {
  const total = bytes.length;
  for (let start = 0; start < total; start += UPLOAD_CHUNK) {
    const end = Math.min(start + UPLOAD_CHUNK, total) - 1;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${total}`,
        },
        body: bytes.subarray(start, end + 1),
      });
      if (res.ok) break;
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < MAX_UPLOAD_RETRIES) {
        const waitSec = retryAfterSeconds(res.headers.get('Retry-After')) ?? 30;
        recordThrottle(res.status, waitSec, 'upload');
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      throw Object.assign(new Error(`Attachment upload failed: HTTP ${res.status}`), { statusCode: res.status });
    }
  }
}
