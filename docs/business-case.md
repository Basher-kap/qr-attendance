# Business Case

## Overview

The client wants a quick and accessible system for monitoring student attendance within event premises. The proposed **QR Code-Based Student Attendance Monitoring System** is designed to record and monitor attendance efficiently.

Each registered student is added manually to the system, which generates a persistent, unique QR code for that student. The attendance clerk records attendance by scanning the student's QR code with a mobile device. The system must record both **check-in and check-out** for the **morning and afternoon sessions**.

## Users

| User | Role |
|---|---|
| Attendance clerk | Scans student QR codes and confirms attendance records |
| Administrator | Manages classes, students and authorized users |

## In scope

- Manual registration of students, grouped by class
- A persistent, unique QR code for every student
- Scanning, review, and confirmation of attendance on a mobile device
- Morning and afternoon check-in and check-out
- Offline use, with synchronization once a connection is available

## Open questions

- Reporting and export of attendance records
- Whether sessions follow fixed time windows or are chosen by the clerk (the current design lets the clerk choose)
