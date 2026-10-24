# Database Design

The schema is in [`supabase/schema.sql`](../supabase/schema.sql). The editable ERD is in [`diagrams/erd.drawio`](diagrams/erd.drawio).

```mermaid
erDiagram
  CLASSES ||--o{ STUDENTS : has
  STUDENTS ||--o{ ATTENDANCE : has
  APP_USERS ||--o{ ATTENDANCE : records

  CLASSES {
    bigint id PK
    text class_name UK
  }
  STUDENTS {
    bigint id PK
    bigint class_id FK
    text full_name
    uuid qr_token UK
    timestamptz created_at
  }
  ATTENDANCE {
    uuid id PK
    bigint student_id FK
    date event_date
    session_type session
    scan_type scan
    timestamptz scanned_at
    text scanned_by FK
  }
  APP_USERS {
    text email PK
    staff_role role
  }
```

## Notes

- `qr_token` is the value encoded in each student's QR code. The app draws the QR image from it, so no image is stored.
- `attendance` holds one row per check-in or check-out. A unique rule on student, date, session and scan type prevents duplicates.
- `app_users` is the allow-list of Google accounts and their roles.
