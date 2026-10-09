---
title: Secret notes
description: Password-protected notes with a time limit, download cap, and text-only files. Browser talks only to a REST API; files live in S3 and metadata in DynamoDB. API runs on Lambda (pay per request).
pubDate: 2026-09-08
featured: true
tags:
  - TypeScript
  - AWS
  - Security
githubUrl: https://github.com/HannaKessler/SecretNotes
demoUrl: /projects/secret-notes
---

Create a note in the demo above. The share link stays in the box under the form so you never leave this write-up. Send the password separately. Recipients open the link on its own unlock page, download the file, and see remaining downloads after that download is recorded. The last download reports that the secret is gone.

This is a public, low-traffic demo in the style of Firefox Send: paste a short note, or attach a small `.txt`, `.csv`, or **text-only PDF**. The uploader chooses the password. There are no user accounts. Recipients can download until the TTL or download cap is hit, then the object is purged from S3 so the global storage quota comes back.

The browser never talks to S3. The API writes to a quarantine prefix, checks the allowlist and rejects PDFs that contain images, then promotes to a private bucket. There is **no antivirus pass**. Recipients should only unlock files from people they trust. This is **not** end-to-end encryption: notes are inspected before they are available. Encrypted or unreadable PDFs fail closed. Images are rejected, including logos and scans inside PDFs.

Local development uses an in-memory store when `DATABASE_URL` is unset. Production runs on AWS Lambda (pay per request) with S3 for files and DynamoDB on-demand for metadata. A scheduled Lambda purges expired objects. A Cloudflare Turnstile check sits in front of create/unlock; the portfolio embed uses the same REST surface (`/v1`) as the standalone app.

The [status page](/status) probes `/v1/status` from the browser and shows whether uploads are open plus how much of the daily quota is used. Probe history stays in that tab. It is not a multi-user metrics backend.
