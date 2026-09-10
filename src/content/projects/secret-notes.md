---
title: Secret notes
kind: software
description: Password-protected notes with a time limit, download cap, ClamAV scanning, and text-only PDFs. Browser talks only to a REST API; files live in S3 and metadata in RDS.
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

The browser never talks to S3. The API writes to a quarantine prefix, scans (allowlist, PDF image walk, ClamAV), then promotes to a private bucket. This is **not** end-to-end encryption: notes are inspected before they are available. Encrypted or unreadable PDFs fail closed. Images are rejected, including logos and scans inside PDFs.

Local development uses an in-memory store when `DATABASE_URL` is unset. Production is meant to run on AWS S3 + RDS, with a purge worker that deletes objects and frees `active_bytes`. A Cloudflare Turnstile check sits in front of create/unlock; the portfolio embed uses the same REST surface (`/v1`) as the standalone app.
