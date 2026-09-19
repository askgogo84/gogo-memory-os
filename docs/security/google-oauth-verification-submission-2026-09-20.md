# AskGogo — Google OAuth verification submission package

**Prepared:** 20 September 2026  
**Production app:** https://askgogo.in  
**App:** AskGogo  
**Data fiduciary:** CIQ AI Solutions Private Limited  
**OAuth callback:** https://app.askgogo.in/api/gmail/callback

## 1. Product description for reviewer

AskGogo is a personal AI assistant used primarily through WhatsApp. Users explicitly connect their Google Workspace account so AskGogo can help them retrieve private context they ask for, such as finding a recent email, locating a booking confirmation, resolving a saved contact, or finding and reading a document already in their Google Drive.

The Google Workspace connection is read-only. Sending email, modifying Drive files, booking, paying, and consequential calendar changes are separate capabilities and are not granted by this read-only Workspace OAuth bundle.

## 2. Requested OAuth scopes

```
openid
email
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/contacts.readonly
https://www.googleapis.com/auth/drive.readonly
```

The unused `profile` scope was removed during the 20 Sep scope audit.

## 3. Scope justifications

### openid + email
Purpose: identify and display which Google account the user connected.

Why needed: AskGogo must bind the OAuth grant to the correct AskGogo account and show the user which Google account is connected.

Why narrower is not sufficient: the app needs the primary connected account identity; no profile fields are requested.

### gmail.readonly
Purpose: let the user ask AskGogo to search/read their Gmail inbox and retrieve relevant email context or attachments.

Examples:
- “Check my inbox.”
- “Find the hotel confirmation for my New York trip.”
- “Find the latest email from Vercel.”
- “Find the invoice attached to that email.”

Why narrower is not sufficient: `gmail.metadata` does not provide the message/attachment content needed for these explicit user-facing features. AskGogo does not request Gmail send, compose, modify, or delete permissions in this bundle.

### contacts.readonly
Purpose: read-only lookup and disambiguation of the user's saved Google contacts.

Examples:
- “Find Priya's email address.”
- “Which contact is this?”
- Resolve multiple matching contacts instead of guessing.

Why narrower is not sufficient: AskGogo needs access to the user's saved contact records to perform user-requested lookups. It does not request contact-write permission.

### drive.readonly
Purpose: search existing Drive files and, when the user asks, read/export supported file content.

Examples:
- “Find my agenda in Drive.”
- “Read the latest proposal in my Drive.”
- “Find the spreadsheet for the Mumbai trip.”

Why narrower is not sufficient:
- `drive.metadata.readonly` explicitly does not allow file-content reads.
- `drive.file` is limited to files individually opened/shared with the app and would not support AskGogo's user-facing feature of searching the user's already-existing Drive and reading the file the user asks for.
- AskGogo does not request a Drive write scope.

## 4. Data-flow summary

1. User sends a Workspace-related request to AskGogo.
2. If not connected, AskGogo issues a signed, short-lived connection link.
3. User explicitly authorizes Google scopes on Google's consent screen.
4. Google redirects to AskGogo's production callback.
5. AskGogo verifies the signed OAuth state and connected Google email.
6. OAuth access/refresh credentials are stored encrypted at rest.
7. On a user request, AskGogo calls only the relevant Google API.
8. Gmail authentication material (OTP/security/login codes and reset/magic-login token URLs) is filtered before downstream use.
9. Result context is returned to the user in WhatsApp/AskGogo.
10. The user can disconnect Google; AskGogo deletes stored Google credentials and attempts Google's token-revocation endpoint.

## 5. User-data handling controls

- Workspace OAuth bundle is read-only.
- User identity is derived from signed OAuth state, never a raw user id in a public callback.
- OAuth credentials are encrypted at rest using authenticated encryption.
- HTTPS is used for Google API and AskGogo traffic.
- OTP/security codes and account-recovery/magic-login URLs are filtered at the Gmail connector boundary.
- Google credentials are not placed into LLM prompts, Activity records, or ordinary memory.
- AskGogo uses owner-scoped database access controls for agent data.
- Consequential actions remain outside this read-only grant and use separate approval boundaries.
- Users can disconnect/revoke Google access.
- Google data is not sold or used for advertising.
- Google data is not used to train or improve a generalized AI/ML model.

## 6. Public URLs

Homepage:
```
https://askgogo.in/
```

Privacy policy:
```
https://askgogo.in/privacy/
```

Terms:
```
https://askgogo.in/terms/
```

OAuth callback:
```
https://app.askgogo.in/api/gmail/callback
```

## 7. Verification demonstration video script

Record one continuous screen capture. Do not edit out the Google consent screen.

### A. Identify AskGogo and the public disclosures
1. Open https://askgogo.in.
2. Show the AskGogo product homepage.
3. Open the Privacy link and briefly show the Google user-data section.

### B. Show the OAuth grant
1. In WhatsApp, send:
   ```
   Check my inbox
   ```
2. Show AskGogo returning the signed Google Workspace connect link.
3. Open the link.
4. Show the Google consent screen, app name, and every requested scope.
5. Approve the grant.
6. Show the “Google Workspace is ready” callback page and connected email.

### C. Demonstrate gmail.readonly
1. Return to WhatsApp.
2. Send:
   ```
   Check my inbox
   ```
3. Show real inbox results.
4. Send a search request for a known sender/subject.
5. If safe test data is available, demonstrate an attachment lookup.

### D. Demonstrate contacts.readonly
Send:
```
Find the Google contact for <TEST CONTACT>
```
Show the real matching contact or the disambiguation behavior.

### E. Demonstrate drive.readonly
Send:
```
Find <TEST FILE> in my Google Drive
```
Show the real Drive result. Then ask to read a supported test document and show that AskGogo returns its content.

### F. Demonstrate user control
Send:
```
Disconnect Google
```
Show the confirmation that stored Google credentials were removed/revoked. Then send:
```
Check my inbox
```
Show that AskGogo asks to reconnect rather than using stale access.

## 8. Reviewer test-account guidance

Use a dedicated Google test account containing:
- at least 3 harmless test emails;
- one email with a harmless attachment;
- 2 test contacts;
- one Google Doc and one Google Sheet with non-sensitive test content.

Do not give reviewers access to a personal inbox containing real confidential information.

## 9. Google Cloud submission checklist

Before clicking Submit for Verification:

- Branding app name exactly matches AskGogo.
- Homepage is https://askgogo.in/.
- Privacy policy is https://askgogo.in/privacy/.
- Terms is https://askgogo.in/terms/.
- Authorized domain includes askgogo.in.
- Domain ownership is verified in Google Search Console by a project Owner/Editor.
- Production support/developer contact email is current.
- Data Access contains only the audited scopes in section 2.
- Remove obsolete OAuth clients that are not production-ready.
- Production and test/staging use separate Google Cloud projects.
- Demo video is uploaded and shareable to the reviewer.
- Scope justifications from section 3 are ready to paste.
- Token encryption is deployed and existing plaintext tokens have been migrated/revoked.
- Disconnect/revoke is live.
- Privacy policy update is live.

## 10. CASA preparation

Restricted-scope security assessment is the final step after Google completes the earlier verification stages and instructs AskGogo to begin the assessment.

Prepare the following evidence now:
- architecture/data-flow diagram;
- production hosting and database inventory;
- OAuth token encryption design and key-management evidence;
- access-control/RLS evidence;
- data deletion and Google disconnect/revoke evidence;
- authentication and session-management controls;
- logging/monitoring and incident-response process;
- dependency and vulnerability scanning evidence;
- source-control access controls;
- secret-management configuration;
- backup/restore and retention policy;
- penetration/static/dynamic test reports as requested by the assigned CASA assurance level.

Do not purchase a CASA assessment before Google Trust & Safety tells the project to start the security-assessment stage. Google assigns the required CASA assurance level and the assessment is recurring annually while restricted scopes remain in use.
