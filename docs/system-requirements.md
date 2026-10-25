# System Requirements

## Functional requirements

| ID | Requirement |
|---|---|
| FR-01 | The system shall let users sign in with Google, and shall grant access only to authorized accounts. |
| FR-02 | The system shall support two roles: administrator and attendance clerk. |
| FR-03 | The system shall show a home screen with the actions to scan a QR code and to manage student data. |
| FR-04 | The system shall allow administrators to add classes and students manually, and to view the students in each class. |
| FR-05 | The system shall generate a unique, persistent QR code for each student and display it in the manage student data screen. |
| FR-06 | The system shall allow the clerk to scan a student's QR code using the device camera. |
| FR-07 | The system shall validate each scanned QR code and, if it is invalid, show an error message and return to the home screen. |
| FR-08 | The system shall display the scanned student's name and attendance status after a valid scan. |
| FR-09 | The system shall allow the clerk to choose check-in or check-out for the morning or afternoon session. |
| FR-10 | The system shall require the clerk to confirm before the attendance record is saved. |
| FR-11 | The system shall save each record with the student, date, session, check-in or check-out, and timestamp. |
| FR-12 | The system shall allow only one record per student, date, session and check type, and shall ignore duplicates. |
| FR-13 | The system shall ask whether to scan another QR code or return to the home screen after a record is saved. |
| FR-14 | The system shall show each student's attendance records for a selected day in the manage student data screen, including the morning and afternoon check-in and check-out times. |
| FR-15 | The system shall allow administrators to edit a student's name and class, rename a class, and delete a student or an empty class. Deleting a student also deletes their attendance records. |
| FR-16 | The system shall allow administrators to regenerate a student's QR code, which invalidates the previous code while keeping the student's attendance records. |
| FR-17 | The system shall let the clerk undo a record immediately after saving it, so the session or check type can be corrected. |
| FR-18 | The system shall allow administrators to download a student's QR code as an image that shows the student's name and class. |

## Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | The system shall work offline, saving records on the device and synchronizing them when a connection is restored. |
| NFR-02 | The system shall run on mobile and desktop browsers and be installable as a PWA. |
| NFR-03 | The QR token shall be unguessable, and access rules shall be enforced by the database (row level security). |
| NFR-04 | Secret keys shall never be stored in the repository or in client code. |
| NFR-05 | Recording an attendance scan shall take as few steps as possible. |