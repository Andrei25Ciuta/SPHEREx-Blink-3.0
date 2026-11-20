begin;

create table public.classification_scores (
  id uuid primary key,
  play_day date not null,
  nickname text not null check (
    nickname = btrim(nickname) and char_length(nickname) between 1 and 40
    and nickname !~ '[[:cntrl:]]'
  ),
  score smallint not null check (score between 0 and 10),
  elapsed_ms integer not null check (elapsed_ms between 10 and 100000),
  created_at timestamptz not null default now()
);

alter table public.classification_scores enable row level security;
revoke all on public.classification_scores from public, anon, authenticated;
grant select on public.classification_scores to anon, authenticated;
grant insert (id, play_day, nickname, score, elapsed_ms)
  on public.classification_scores to anon, authenticated;

create policy "read today's classification scores"
  on public.classification_scores for select to anon, authenticated
  using (play_day = (now() at time zone 'UTC')::date);

create policy "post today's classification scores"
  on public.classification_scores for insert to anon, authenticated
  with check (play_day = (now() at time zone 'UTC')::date);

create index classification_scores_daily_nickname
  on public.classification_scores (play_day, lower(nickname), score desc, elapsed_ms, created_at, id);

create view public.classification_daily_best with (security_invoker = true) as
select distinct on (play_day, lower(nickname))
  play_day, nickname, score, elapsed_ms, created_at, id
from public.classification_scores
order by play_day, lower(nickname), score desc, elapsed_ms, created_at, id;

revoke all on public.classification_daily_best from public, anon, authenticated;
grant select on public.classification_daily_best to anon, authenticated;

commit;
