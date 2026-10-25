# Google Workspace OAuth scope audit — 20 Sep 2026

## Decision

Keep one read-only Workspace consent bundle for the three user-facing features that are already implemented:
- Gmail inbox/search/attachment reading
- Google Contacts lookup/resolution
- Google Drive search + supported file-content reads

Remove the unused OpenID `profile` scope.

## Final requested scopes

```
openid
email
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/contacts.readonly
https://www.googleapis.com/auth/drive.readonly
```

## Why each scope exists

### openid + email
Used only to establish and display which Google account was connected. AskGogo does not use Google profile fields, so `profile` is removed.

### gmail.readonly
Required because AskGogo reads message metadata/snippets and, for explicit document/brief requests, fetches Gmail message content and attachments. A metadata-only Gmail scope would not support these shipped use cases.

### contacts.readonly
Required for read-only contact lookup and disambiguation. AskGogo does not request the write-capable contacts scope.

### drive.readonly
Required because AskGogo searches the user's Drive and can read/export supported file contents. `drive.metadata.readonly` is insufficient because it explicitly does not allow file-content reads. `drive.file` would require file-by-file user selection and would not support autonomous search across already-existing Drive files.

## Scopes deliberately not requested

- `profile` — unused
- Gmail send/modify/compose — sending remains a separate approval-gated capability and is not part of this read bundle
- Drive write scopes — not needed
- Contacts write scope — not needed
- Calendar — remains in its existing separate OAuth flow

## Verification strategy

Submit Gmail + Contacts + Drive together because all three correspond to live user-facing AskGogo features. Gmail and Drive are restricted scopes and therefore require restricted-scope verification; because AskGogo stores/transmits restricted-scope data server-side, prepare the required security assessment. Calendar stays separate so the existing Calendar flow is not coupled to this submission.
