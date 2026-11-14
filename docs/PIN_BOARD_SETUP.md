# Shared Discovery Pin Board (Supabase)

The pin board reads and adds pins in a Supabase table (`frontend/js/features/pinSync.js`, configured in `frontend/js/config.js`:
`PIN_BOARD_URL`, `PIN_BOARD_KEY`). Visitors need no account: they type an observer name. The project owner has one Supabase account.

What the table allows (row-level security): **select** and **insert** for everyone; **no update and no delete policy**, so nobody can change or
erase a pin from the site. The owner can delete spam in the Supabase dashboard (Table Editor → pins). The key in `config.js` is the
*publishable* key, made to be public; the *secret* key and the database password must never be in the repository.

Every pin carries a SHA-256 of its own canonical text; the page drops any shared record whose hash does not match.
Limits: anyone can add fake pins (no account means no identity); names and positions are public and permanent.

Table (run once in the SQL Editor):

```sql
create table public.pins (
  id text primary key,
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  observer text not null check (char_length(observer) between 1 and 40),
  ra double precision not null check (ra >= 0 and ra < 360),
  dec double precision not null check (dec between -90 and 90),
  found_at timestamptz not null,
  data_kind text not null check (data_kind in ('real', 'synthetic')),
  record jsonb not null check (pg_column_size(record) < 4000),
  created_at timestamptz not null default now()
);
alter table public.pins enable row level security;
create policy "anyone can read pins" on public.pins for select using (true);
create policy "anyone can add a pin" on public.pins for insert with check (true);
```

Checked on 14 Nov 2026: a read from the GitHub Pages origin answers 200; an insert with a malformed hash is refused (400, check constraint).
Not checked: that an update or delete is refused (no test row was written, to keep the board clean).

The page asks the shared board only once the pin board is on screen, and never by itself in an automated browser (`navigator.webdriver`), so the offline smoke test stays offline; the Refresh button loads it on demand.
